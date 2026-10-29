const { authHeaders, responseAuth } = require("./testSession");
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const os = require("node:os");
const path = require("node:path");
const Project = require("./models/Project");
const Application = require("./models/Application");
const AdminUser = require("./models/User");

process.env.JWT_SECRET = "phase6-test-only-secret-with-at-least-32-characters";
const app = require("./app");

test("real client-to-freelancer workflow with revisions, dependencies and trust", async () => {
  const databaseName = `freelancechain_e2e_${crypto.randomBytes(5).toString("hex")}`;
  const uploadDirectory = path.join(os.tmpdir(), `freelancechain-e2e-${databaseName}`);
  const previousUploadDirectory = process.env.PRIVATE_UPLOAD_DIR;
  process.env.PRIVATE_UPLOAD_DIR = uploadDirectory;
  const mongoBase = process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017";
  const server = app.listen(0, "127.0.0.1");
  const address = await new Promise(resolve => server.once("listening", () => resolve(server.address())));
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const originalFetch = global.fetch;
  let liveClient;
  let liveFreelancer;
  const priorResetEnv = Object.fromEntries(["APP_ORIGIN", "RESEND_API_KEY", "RESET_FROM_EMAIL", "RESET_DELIVERY", "OPENAI_API_KEY"].map(key => [key, process.env[key]]));

  async function request(method, path, token, body, expected = 200) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...authHeaders(token), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (path === "/api/auth/login" && response.ok) data.sessionAuth = responseAuth(response, data);
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }

  async function uploadRequest(method, path, token, fields, files = [], expected = 200) {
    const body = new FormData();
    Object.entries(fields || {}).forEach(([key, value]) => body.append(key, value));
    files.forEach(file => body.append("files", new Blob([file.bytes], { type: file.type }), file.name));
    const response = await fetch(`${baseUrl}${path}`, { method, headers: authHeaders(token), body });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }

  async function downloadRequest(path, token, expected = 200) {
    const response = await fetch(`${baseUrl}${path}`, { headers: authHeaders(token) });
    assert.equal(response.status, expected, `GET ${path}`);
    return response;
  }

  function offerTerms(amount, scope = "Complete the agreed project scope and provide a reviewable delivery.") {
    return { scope, amount, deliveryDate: "2030-12-20", milestones: [{ title: "Delivery", description: "Complete and review the deliverable.", payment: amount, dueDate: "2030-12-20" }] };
  }

  async function openUpdates(token) {
    const abort = new AbortController();
    const response = await originalFetch(`${baseUrl}/api/updates`, { headers: authHeaders(token), signal: abort.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const stream = { abort, reader: response.body.getReader(), buffer: "" };
    await nextUpdate(stream, "ready");
    return stream;
  }

  async function nextUpdate(stream, expectedType, projectId) {
    for (;;) {
      const boundary = stream.buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const frame = stream.buffer.slice(0, boundary);
        stream.buffer = stream.buffer.slice(boundary + 2);
        const type = frame.split("\n").find(line => line.startsWith("event:"))?.slice(6).trim();
        const raw = frame.split("\n").find(line => line.startsWith("data:"))?.slice(5).trim();
        if (type === expectedType) {
          const data = JSON.parse(raw);
          if (!projectId || data.projectId === projectId) return data;
        }
        continue;
      }
      let timeout;
      const chunk = await Promise.race([
        stream.reader.read(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType} update`)), 3000); }),
      ]).finally(() => clearTimeout(timeout));
      assert.equal(chunk.done, false, "Live update stream closed early");
      stream.buffer += new TextDecoder().decode(chunk.value);
    }
  }

  try {
    await mongoose.connect(`${mongoBase}/${databaseName}`, { serverSelectionTimeoutMS: 5000 });
    process.env.APP_ORIGIN = baseUrl;
    assert.equal((await request("GET", "/api/health")).status, "ok");
    const sameOriginHealth = await fetch(`${baseUrl}/api/health`, { headers: { Origin: baseUrl } });
    assert.equal(sameOriginHealth.status, 200);
    const blockedOrigin = await fetch(`${baseUrl}/api/health`, { headers: { Origin: "https://unrelated.example" } });
    assert.equal(blockedOrigin.status, 403);
    const spaRoute = await fetch(`${baseUrl}/client-dashboard`, { headers: { Accept: "text/html" } });
    assert.equal(spaRoute.status, 200);
    const shell = await spaRoute.text();
    assert.match(shell, /<div id="root">/);
    assert.match(shell, /<script[^>]+src="\/static\/js\/main\.[^"]+\.js"/);

    const password = "testing-password-123";
    await request("POST", "/api/auth/register", null, { name: { unexpected: true }, email: "bad@example.test", password, role: "client" }, 400);
    await request("POST", "/api/auth/register", null, { name: "Spoof Admin", email: "spoof-admin@example.test", password, role: "admin" }, 400);
    const registeredClient = await request("POST", "/api/auth/register", null, { name: "Client One", email: "client@example.test", password, role: "client" }, 201);
    const registeredFreelancer = await request("POST", "/api/auth/register", null, { name: "Freelancer One", email: "freelancer@example.test", password, role: "freelancer" }, 201);
    const registeredOther = await request("POST", "/api/auth/register", null, { name: "Other Freelancer", email: "other@example.test", password, role: "freelancer" }, 201);
    const clientToken = (await request("POST", "/api/auth/login", null, { email: "client@example.test", password, role: "client" })).sessionAuth;
    const freelancerToken = (await request("POST", "/api/auth/login", null, { email: "freelancer@example.test", password, role: "freelancer" })).sessionAuth;
    const otherToken = (await request("POST", "/api/auth/login", null, { email: "other@example.test", password, role: "freelancer" })).sessionAuth;
    const adminPassword = "integration-admin-password-123";
    const adminHash = await bcrypt.hash(adminPassword, 10);
    const adminOneId = new mongoose.Types.ObjectId();
    const adminTwoId = new mongoose.Types.ObjectId();
    await AdminUser.collection.insertMany([
      { _id: adminOneId, name: "Review Admin One", email: "admin-one@example.test", password: adminHash, role: "admin", tokenVersion: 0, createdAt: new Date(), updatedAt: new Date() },
      { _id: adminTwoId, name: "Review Admin Two", email: "admin-two@example.test", password: adminHash, role: "admin", tokenVersion: 0, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const adminOneToken = (await request("POST", "/api/auth/login", null, { email: "admin-one@example.test", password: adminPassword, role: "admin" })).sessionAuth;
    const adminTwoToken = (await request("POST", "/api/auth/login", null, { email: "admin-two@example.test", password: adminPassword, role: "admin" })).sessionAuth;
    await request("POST", "/api/auth/register", null, { name: "Admin Promotion", email: "client@example.test", password, role: "admin" }, 400);
    assert.deepEqual((await request("GET", "/api/profile/me", clientToken)).company, { name: "", overview: "" });
    await request("PUT", "/api/profile/me", clientToken, { companyName: "Northstar Studio", companyOverview: "A small product team building accessible tools." });
    await request("PUT", "/api/profile/me", clientToken, { companyName: "x".repeat(101), companyOverview: "" }, 400);
    await request("PUT", "/api/profile/me", clientToken, { companyName: { value: "spoof" }, companyOverview: "" }, 400);
    await request("GET", "/api/updates", null, null, 401);
    liveClient = await openUpdates(clientToken);
    liveFreelancer = await openUpdates(freelancerToken);

    await request("PUT", "/api/profile/me", freelancerToken, { headline: "React developer", bio: "I build web applications.", skills: ["React"], experienceYears: 3, portfolioUrl: "" });
    assert.equal((await request("GET", "/api/talent", clientToken)).total, 0);
    await request("GET", `/api/talent/${registeredFreelancer.user.id}`, clientToken, null, 404);
    await request("GET", "/api/talent", freelancerToken, null, 403);
    await request("PUT", "/api/profile/me", freelancerToken, { headline: "React developer", bio: "I build web applications.", skills: ["React"], experienceYears: 3, portfolioUrl: "", discoverable: true, availability: "limited", hourlyRate: 85, portfolioItems: [{ title: "Dashboard UI", description: "A responsive data dashboard.", url: "https://example.test/dashboard" }] });
    await request("PUT", "/api/profile/me", freelancerToken, { headline: "React developer", bio: "I build web applications.", skills: ["React"], experienceYears: 3, portfolioUrl: "", discoverable: true, hourlyRate: -1 }, 400);
    await request("PUT", "/api/profile/me", freelancerToken, { headline: "React developer", bio: "I build web applications.", skills: ["React"], experienceYears: 3, portfolioUrl: "", discoverable: true, portfolioItems: [{ title: "Bad link", description: "Invalid scheme.", url: "javascript:alert(1)" }] }, 400);
    await request("PUT", "/api/profile/me", otherToken, { headline: "Node developer", bio: "I build Node services.", skills: ["Node.js"], experienceYears: 7, portfolioUrl: "", discoverable: true, availability: "available", hourlyRate: 120 });
    const directory = await request("GET", "/api/talent?q=React&availability=limited&minExperience=3&maxExperience=5", clientToken);
    assert.equal(directory.total, 1);
    assert.equal(directory.talent[0].name, "Freelancer One");
    assert.equal(directory.talent[0].availability, "limited");
    assert.equal(directory.talent[0].hourlyRate, 85);
    assert.equal(directory.talent[0].portfolioItems[0].title, "Dashboard UI");
    assert.equal(directory.talent[0].email, undefined);
    assert.equal(directory.talent[0].profile, undefined);
    const talentPageOne = await request("GET", "/api/talent?pageSize=1&page=1&sort=experience-high", clientToken);
    const talentPageTwo = await request("GET", "/api/talent?pageSize=1&page=2&sort=experience-high", clientToken);
    assert.equal(talentPageOne.total, 2);
    assert.equal(talentPageOne.pages, 2);
    assert.equal(talentPageOne.talent[0].name, "Other Freelancer");
    assert.equal(talentPageTwo.talent[0].name, "Freelancer One");
    await request("GET", "/api/talent?minExperience=8&maxExperience=2", clientToken, null, 400);
    await request("GET", "/api/talent?unexpected=1", clientToken, null, 400);
    const publicTalentProfile = await request("GET", `/api/talent/${directory.talent[0].id}`, clientToken);
    assert.equal(publicTalentProfile.name, "Freelancer One");
    assert.equal(publicTalentProfile.email, undefined);
    assert.equal(publicTalentProfile.reviews.count, 0);
    await request("GET", `/api/talent/${directory.talent[0].id}`, otherToken, null, 403);
    const planInput = { title: "Build a dashboard", description: "Build a responsive dashboard with a Node API and clear project metrics.", requiredSkills: ["React", "Node.js"], budget: 10000 };
    const skillBrief = { ...planInput, category: "Web Development", description: "Build a React dashboard with Node.js APIs and MongoDB for weekly reports." };
    await request("POST", "/api/projects/suggest-skills", null, skillBrief, 401);
    await request("POST", "/api/projects/suggest-skills", freelancerToken, skillBrief, 403);
    await request("POST", "/api/projects/suggest-skills", clientToken, { ...skillBrief, description: "short" }, 400);
    await request("POST", "/api/projects/suggest-skills", clientToken, { ...skillBrief, category: "Other" }, 400);
    const extracted = await request("POST", "/api/projects/suggest-skills", clientToken, skillBrief);
    assert.deepEqual(extracted.suggestions.map(item => item.skill), ["React", "Node.js", "MongoDB"]);
    assert.equal(extracted.method, "catalogue_extraction_v1");
    const writingSkills = await request("POST", "/api/projects/suggest-skills", clientToken, { ...skillBrief, category: "Writing & Translation", description: "Write a technical guide about React and Node.js with proofreading for beginners." });
    assert.deepEqual(writingSkills.suggestions.map(item => item.skill), ["Technical writing", "Proofreading"]);
    const suggested = await request("POST", "/api/projects/suggest-milestones", clientToken, planInput);
    assert.equal(suggested.method, "guided_template");
    assert.deepEqual(suggested.suggestions.map(step => step.dependsOn), [[], [0], [0], [1, 2]]);
    assert.equal(suggested.suggestions.reduce((sum, step) => sum + step.payment, 0), 10000);
    await request("POST", "/api/projects/suggest-milestones", freelancerToken, planInput, 403);
    await request("POST", "/api/projects/suggest-milestones", clientToken, { ...planInput, description: "short" }, 400);
    const writingPlan = await request("POST", "/api/projects/suggest-milestones", clientToken, { ...planInput, category: "Writing & Translation" });
    assert.equal(writingPlan.suggestions[0].title, "Outline and research");
    const customPlan = await request("POST", "/api/projects/suggest-milestones", clientToken, { ...planInput, category: "Other", customCategory: "Technical writing" });
    assert.equal(customPlan.suggestions[0].title, "Outline and research");
    await request("POST", "/api/projects/suggest-milestones", clientToken, { ...planInput, category: "Other" }, 400);
    assert.equal((await request("GET", "/api/projects/mine", clientToken)).length, 0);
    assert.deepEqual(await request("GET", "/api/projects/public"), { projects: [], total: 0, page: 1, pageSize: 12, pages: 0 });
    delete process.env.OPENAI_API_KEY;
    assert.equal((await request("GET", "/api/projects/ai-planning-status", clientToken)).available, false);
    await request("POST", "/api/projects/ai-suggest-milestones", freelancerToken, planInput, 403);
    await request("POST", "/api/projects/ai-suggest-milestones", clientToken, planInput, 503);
    process.env.OPENAI_API_KEY = "test-only-key";
    let planRequest;
    global.fetch = (url, options) => {
      if (url === "https://api.openai.com/v1/responses") {
        planRequest = JSON.parse(options.body);
        return Promise.resolve({ ok: true, json: async () => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ milestones: [
          { title: "Scope", description: "Confirm dashboard requirements.", weight: 30, dependsOn: [] },
          { title: "Build", description: "Deliver the dashboard and API.", weight: 70, dependsOn: [0] },
        ] }) }] }] }) });
      }
      return originalFetch(url, options);
    };
    assert.equal((await request("GET", "/api/projects/ai-planning-status", clientToken)).available, true);
    const aiPlan = await request("POST", "/api/projects/ai-suggest-milestones", clientToken, { ...planInput, deadline: "2030-12-31" });
    assert.equal(aiPlan.method, "ai_assisted");
    assert.equal(aiPlan.suggestions.reduce((sum, step) => sum + step.payment, 0), 10000);
    assert.equal(planRequest.store, false);
    await request("POST", "/api/projects/ai-suggest-milestones", clientToken, planInput, 429);
    assert.equal((await request("GET", "/api/projects/mine", clientToken)).length, 0);
    global.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
    const legacyProject = await Project.create({ title: "Legacy active room", description: "An active workroom from before structured hiring.", budget: 500, deadline: "2030-12-31", client: registeredClient.user.id, freelancer: registeredFreelancer.user.id, status: "In Progress", milestones: [{ title: "Legacy delivery", status: "active", payment: 500 }] });
    const legacyApplication = await Application.create({ project: legacyProject._id, freelancer: registeredFreelancer.user.id, proposal: "Legacy text-only proposal remains readable.", status: "ACCEPTED" });
    const legacyMine = await request("GET", "/api/applications/mine", freelancerToken);
    assert.equal(legacyMine.find(item => String(item._id) === String(legacyApplication._id)).proposal, "Legacy text-only proposal remains readable.");
    assert.equal(legacyMine.find(item => String(item._id) === String(legacyApplication._id)).proposedPrice, null);
    assert.deepEqual(await request("GET", `/api/messages/application/${legacyApplication._id}`, clientToken), []);
    await request("GET", `/api/messages/application/${legacyApplication._id}`, otherToken, null, 403);
    const createBody = {
      title: "Build a dashboard", description: "Build a responsive dashboard with clear project metrics and user-friendly views.", category: "Web Development",
      requiredSkills: ["React"], budget: 10000, deadline: "2030-12-31",
      milestones: [{ title: "Design", payment: 4000, dueDate: "2030-12-10", dependsOn: [] }, { title: "Implementation", payment: 6000, dueDate: "2030-12-20", dependsOn: [0] }],
    };
    for (const deadline of ["2000-01-01", "2030-02-31", "2030-12-31T00:00:00Z"]) await request("POST", "/api/projects/create", clientToken, { ...createBody, deadline }, 400);
    await request("POST", "/api/projects/create", clientToken, { ...createBody, milestones: [{ title: "Too late", dueDate: "2031-01-01", dependsOn: [] }] }, 400);
    await request("POST", "/api/projects/create", clientToken, { ...createBody, milestones: [{ title: "First", dueDate: "2030-12-20", dependsOn: [] }, { title: "Earlier dependent", dueDate: "2030-12-10", dependsOn: [0] }] }, 400);
    await request("POST", "/api/projects/suggest-milestones", clientToken, { ...planInput, deadline: "2000-01-01" }, 400);
    await request("POST", "/api/projects/ai-suggest-milestones", clientToken, { ...planInput, deadline: "2000-01-01" }, 400);
    const first = (await request("POST", "/api/projects/create", clientToken, createBody, 201)).project;
    assert.equal(first.milestones[0].dueDate, "2030-12-10");
    const publicJobs = await request("GET", "/api/projects/public?q=dashboard");
    assert.equal(publicJobs.total, 1);
    assert.equal(publicJobs.projects[0].title, createBody.title);
    assert.equal(publicJobs.projects[0].budget, createBody.budget);
    assert.equal(publicJobs.projects[0].category, "Web Development");
    assert.equal(publicJobs.projects[0].client, undefined);
    assert.equal(publicJobs.projects[0].activity, undefined);
    assert.equal(publicJobs.projects[0].milestones, undefined);
    const publicDetail = await request("GET", `/api/projects/public/${first._id}`);
    assert.equal(publicDetail.title, createBody.title);
    assert.equal(publicDetail.category, "Web Development");
    assert.deepEqual(publicDetail.milestones.map(item => item.title), ["Design", "Implementation"]);
    assert.equal(publicDetail.milestones[1].dueDate, "2030-12-20");
    assert.deepEqual(publicDetail.company, { name: "Northstar Studio", overview: "A small product team building accessible tools." });
    assert.equal(publicDetail.client, undefined);
    assert.equal(publicDetail.email, undefined);
    assert.equal(publicDetail.activity, undefined);
    assert.equal(publicDetail.milestones[0].submittedWork, undefined);
    await request("GET", "/api/projects/public/not-an-id", null, null, 400);
    assert.equal((await request("GET", "/api/projects/public?skill=React")).total, 1);
    await request("GET", "/api/projects/public?page=0", null, null, 400);
    await request("GET", "/api/projects/public?minBudget=20000&maxBudget=10000", null, null, 400);
    await request("GET", "/api/projects/public?deadlineFrom=2030-02-31", null, null, 400);
    await request("GET", "/api/projects/public?unexpected=1", null, null, 400);
    await request("POST", "/api/projects/create", clientToken, { ...createBody, category: "Unlisted" }, 400);
    const pageJob = (await request("POST", "/api/projects/create", clientToken, { ...createBody, title: "Create an illustration", category: "Design & Creative", requiredSkills: ["Figma"], budget: 6000, deadline: "2031-01-15", milestones: [{ title: "Artwork", payment: 6000, dependsOn: [] }] }, 201)).project;
    const withdrawable = (await request("POST", "/api/applications", otherToken, { projectId: pageJob._id, proposal: "I can produce the illustration and prepare final files.", proposedPrice: 6000, deliveryEstimateDays: 16 }, 201)).application;
    await request("PATCH", `/api/applications/${withdrawable._id}`, freelancerToken, { proposal: "Unauthorized edit attempt.", proposedPrice: 6000, deliveryEstimateDays: 16 }, 403);
    const beforeEditOffer = await request("POST", `/api/applications/${withdrawable._id}/offer`, clientToken, { terms: offerTerms(6000) }, 201);
    const updatedWithdrawable = await request("PATCH", `/api/applications/${withdrawable._id}`, otherToken, { proposal: "I can produce the illustration and include two review rounds.", proposedPrice: 5800, deliveryEstimateDays: 14, portfolioLinks: [], answers: [] });
    assert.equal(updatedWithdrawable.application.proposedPrice, 5800);
    assert.equal(updatedWithdrawable.application.offers.find(item => String(item._id) === String(beforeEditOffer.application.currentOfferId)).status, "STALE");
    const beforeWithdrawOffer = await request("POST", `/api/applications/${withdrawable._id}/offer`, clientToken, { terms: offerTerms(5800) }, 201);
    await request("POST", `/api/applications/${withdrawable._id}/withdraw`, freelancerToken, {}, 403);
    const withdrawn = await request("POST", `/api/applications/${withdrawable._id}/withdraw`, otherToken, {});
    assert.equal(withdrawn.application.status, "WITHDRAWN");
    assert.equal(withdrawn.application.offers.find(item => String(item._id) === String(beforeWithdrawOffer.application.currentOfferId)).status, "STALE");
    const declinable = (await request("POST", "/api/applications", freelancerToken, { projectId: pageJob._id, proposal: "I can design the illustration and provide source files.", proposedPrice: 6000, deliveryEstimateDays: 18 }, 201)).application;
    const declineOffer = await request("POST", `/api/applications/${declinable._id}/offer`, clientToken, { terms: offerTerms(6000) }, 201);
    const declineOfferId = String(declineOffer.application.currentOfferId);
    const declinedOffer = await request("POST", `/api/applications/${declinable._id}/offer/${declineOfferId}/decline`, freelancerToken, {});
    assert.equal(declinedOffer.application.status, "REJECTED");
    assert.equal(declinedOffer.application.currentOfferState, "DECLINED");
    await request("PATCH", "/api/notifications/read-all", freelancerToken);
    const jobsFirstPage = await request("GET", "/api/projects/public?pageSize=1&page=1&sort=oldest");
    const jobsSecondPage = await request("GET", "/api/projects/public?pageSize=1&page=2&sort=oldest");
    assert.equal(jobsFirstPage.total, 2);
    assert.equal(jobsFirstPage.pages, 2);
    assert.equal(jobsFirstPage.projects[0]._id, first._id);
    assert.equal(jobsSecondPage.projects[0]._id, pageJob._id);
    const filteredJobs = await request("GET", "/api/projects/public?category=Web%20Development&skill=React&minBudget=9000&maxBudget=11000&deadlineFrom=2030-12-01&deadlineTo=2030-12-31");
    assert.equal(filteredJobs.total, 1);
    assert.equal(filteredJobs.projects[0]._id, first._id);
    await Project.collection.updateOne({ _id: new mongoose.Types.ObjectId(first._id) }, { $unset: { category: "" } });
    const legacyJobs = await request("GET", "/api/projects/public?category=Other&q=dashboard");
    assert.equal(legacyJobs.total, 1);
    assert.equal(legacyJobs.projects[0].category, "Other");
    assert.equal((await request("GET", "/api/projects/public?q=not-a-match")).total, 0);
    assert.deepEqual(await request("GET", "/api/projects/saved", freelancerToken), []);
    await request("PUT", `/api/projects/saved/${first._id}`, clientToken, null, 403);
    await request("PUT", `/api/projects/saved/${first._id}`, freelancerToken);
    await request("PUT", `/api/projects/saved/${first._id}`, freelancerToken);
    assert.deepEqual(await request("GET", "/api/projects/saved", freelancerToken), [first._id]);
    await request("DELETE", `/api/projects/saved/${first._id}`, freelancerToken);
    assert.deepEqual(await request("GET", "/api/projects/saved", freelancerToken), []);
    assert.equal((await nextUpdate(liveClient, "project", first._id)).projectId, first._id);
    await nextUpdate(liveFreelancer, "marketplace");
    assert.deepEqual(first.milestones.map(item => item.status), ["active", "locked"]);
    assert.equal((await request("GET", "/api/projects/mine", clientToken))[0].outlook.status, "not_started");
    await request("GET", `/api/projects/${first._id}`, otherToken, null, 403);
    const inviteBody = { projectId: first._id, freelancerId: directory.talent[0].id, note: "Your React experience would fit this dashboard project." };
    await request("POST", "/api/invitations", freelancerToken, inviteBody, 403);
    await request("POST", "/api/invitations", clientToken, inviteBody, 201);
    await nextUpdate(liveFreelancer, "applications", first._id);
    await request("GET", "/api/notifications", null, null, 401);
    const firstNotification = (await request("GET", "/api/notifications", freelancerToken)).notifications[0];
    assert.equal(firstNotification.type, "invitation");
    assert.equal((await request("GET", "/api/notifications", freelancerToken)).unreadCount, 1);
    await request("PATCH", `/api/notifications/${firstNotification._id}/read`, clientToken, null, 404);
    await request("PATCH", `/api/notifications/${firstNotification._id}/read`, freelancerToken);
    assert.equal((await request("GET", "/api/notifications", freelancerToken)).unreadCount, 0);
    await request("POST", "/api/invitations", clientToken, inviteBody, 409);
    assert.equal((await request("GET", "/api/invitations/mine", freelancerToken))[0].status, "PENDING");
    await request("POST", "/api/applications", freelancerToken, { projectId: first._id, proposal: "I will deliver design and implementation in two stages.", proposedPrice: 10000, deliveryEstimateDays: 28, portfolioLinks: ["https://example.test/work"], answers: [{ question: "Relevant experience?", answer: "I have shipped responsive dashboards." }] }, 201);
    assert.equal((await request("GET", "/api/invitations/mine", freelancerToken))[0].status, "RESPONDED");
    assert.equal((await nextUpdate(liveClient, "applications", first._id)).projectId, first._id);
    const initialApplicants = await request("GET", `/api/applications/project/${first._id}`, clientToken);
    assert.equal(initialApplicants[0].trust.score, null);
    assert.deepEqual(initialApplicants[0].match.matchedSkills, ["React"]);
    assert.equal(initialApplicants[0].proposedPrice, 10000);
    assert.equal(initialApplicants[0].deliveryEstimateDays, 28);
    assert.equal(initialApplicants[0].portfolioLinks[0], "https://example.test/work");
    assert.equal(initialApplicants[0].match.compatibility.budget, "within_budget");
    assert.equal(initialApplicants[0].match.compatibility.availability, "limited");
    await request("PATCH", `/api/applications/${initialApplicants[0]._id}/shortlist`, clientToken, { shortlisted: true });
    await request("PATCH", `/api/applications/${initialApplicants[0]._id}/shortlist`, freelancerToken, { shortlisted: false }, 403);
    await request("POST", "/api/applications", freelancerToken, { projectId: first._id, proposal: "Bad price proposal.", proposedPrice: -10, deliveryEstimateDays: 12 }, 400);
    const firstTerms = { scope: "Design and implement the dashboard described in the project brief.", amount: 10000, deliveryDate: "2030-12-20", milestones: [{ title: "Design", description: "Approve the responsive design.", payment: 4000 }, { title: "Implementation", description: "Complete and review the dashboard.", payment: 6000, dueDate: "2030-12-20" }] };
    const firstOffer = await request("POST", `/api/applications/${initialApplicants[0]._id}/offer`, clientToken, { terms: firstTerms }, 201);
    const firstOfferId = String(firstOffer.application.currentOfferId);
    assert.equal(firstOffer.application.offers[0].acceptances.length, 1);
    await request("PATCH", `/api/applications/${initialApplicants[0]._id}/accept`, clientToken, null, 409);
    const stillOpen = await request("GET", `/api/projects/${first._id}`, clientToken);
    assert.equal(stillOpen.status, "Open");
    assert.equal(stillOpen.freelancer, null);
    const editedProposal = await request("PATCH", `/api/applications/${initialApplicants[0]._id}`, freelancerToken, { proposal: "Updated plan for the dashboard and its responsive views.", proposedPrice: 9800, deliveryEstimateDays: 24, portfolioLinks: ["https://example.test/revised-work"], answers: [] });
    assert.equal(editedProposal.invalidatedOffer, true);
    assert.equal(editedProposal.application.offers[0].status, "STALE");
    assert.equal(editedProposal.application.proposedPrice, 9800);
    await request("POST", `/api/applications/${initialApplicants[0]._id}/offer/${firstOfferId}/accept`, freelancerToken, {}, 409);
    const revisedTerms = { ...firstTerms, amount: 9800, milestones: [{ ...firstTerms.milestones[0], payment: 3800 }, { ...firstTerms.milestones[1], payment: 6000 }] };
    const secondOffer = await request("POST", `/api/applications/${initialApplicants[0]._id}/offer`, clientToken, { terms: revisedTerms }, 201);
    const secondOfferId = String(secondOffer.application.currentOfferId);
    const counterTerms = { ...revisedTerms, scope: "Deliver the revised responsive dashboard with agreed review checkpoints.", amount: 9500, milestones: [{ ...revisedTerms.milestones[0], payment: 3500 }, { ...revisedTerms.milestones[1], payment: 6000 }] };
    const freelancerCounter = await request("POST", `/api/applications/${initialApplicants[0]._id}/offer`, freelancerToken, { replacesOfferId: secondOfferId, terms: counterTerms }, 201);
    const finalOfferId = String(freelancerCounter.application.currentOfferId);
    assert.equal(freelancerCounter.application.offers.length, 3);
    assert.equal(freelancerCounter.application.offers[1].status, "STALE");
    await request("POST", `/api/applications/${initialApplicants[0]._id}/offer/${secondOfferId}/accept`, freelancerToken, {}, 409);
    await request("POST", `/api/applications/${initialApplicants[0]._id}/offer/${finalOfferId}/accept`, otherToken, {}, 403);
    await request("PATCH", "/api/notifications/read-all", clientToken);
    await request("PATCH", "/api/notifications/read-all", freelancerToken);
    const conversationPath = `/api/messages/application/${initialApplicants[0]._id}`;
    await request("GET", conversationPath, otherToken, null, 403);
    await request("POST", conversationPath, clientToken, { body: "Can you share your approach to the first milestone?" }, 201);
    await uploadRequest("POST", conversationPath, freelancerToken, { body: "I will deliver the design for review before implementation." }, [{ name: "approach.pdf", type: "application/pdf", bytes: "%PDF-1.7\nproject approach" }], 201);
    await uploadRequest("POST", conversationPath, clientToken, {}, [{ name: "reference.png", type: "image/png", bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]) }], 201);
    const conversation = await request("GET", conversationPath, freelancerToken);
    assert.equal(conversation.length, 3);
    assert.equal(conversation[0].body, "Can you share your approach to the first milestone?");
    assert.equal(conversation[1].attachments[0].filename, "approach.pdf");
    assert.equal(conversation[2].body, "");
    assert.equal(conversation[2].attachments[0].filename, "reference.png");
    assert.equal((await request("GET", "/api/notifications", clientToken)).unreadCount, 1);
    await request("PATCH", "/api/notifications/read-all", clientToken);
    assert.equal((await request("GET", "/api/notifications", clientToken)).unreadCount, 0);
    await request("POST", conversationPath, freelancerToken, { body: " " }, 400);
    delete process.env.OPENAI_API_KEY;
    assert.equal((await request("GET", "/api/applications/ai-status", clientToken)).available, false);
    await request("POST", `/api/applications/project/${first._id}/ai-rank`, clientToken, {}, 503);
    await request("POST", `/api/applications/project/${first._id}/ai-rank`, freelancerToken, {}, 403);
    process.env.OPENAI_API_KEY = "test-only-key";
    let embeddingInput;
    global.fetch = (url, options) => {
      if (url === "https://api.openai.com/v1/embeddings") {
        embeddingInput = JSON.parse(options.body);
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0.8, 0.6] }] }) });
      }
      return originalFetch(url, options);
    };
    const aiRanking = await request("POST", `/api/applications/project/${first._id}/ai-rank`, clientToken, {});
    assert.equal(aiRanking.ranking[0].applicationId, initialApplicants[0]._id);
    assert.equal(aiRanking.ranking[0].semanticScore, 80);
    assert.equal(embeddingInput.input.length, 2);
    assert.ok(embeddingInput.input[0].includes("responsive dashboard"));
    assert.ok(!JSON.stringify(embeddingInput).includes("client@example.test"));
    await request("POST", `/api/applications/project/${first._id}/ai-rank`, clientToken, {}, 429);
    global.fetch = originalFetch;
    const agreed = await request("POST", `/api/applications/${initialApplicants[0]._id}/offer/${finalOfferId}/accept`, clientToken, {});
    assert.equal(agreed.application.status, "ACCEPTED");
    assert.equal(agreed.project.status, "In Progress");
    assert.equal(agreed.project.agreement.version, 3);
    assert.equal(agreed.project.agreement.terms.amount, 9500);
    assert.equal(agreed.project.budget, 9500);
    assert.equal(agreed.project.deadline, "2030-12-20");
    assert.equal(agreed.project.description, counterTerms.scope);
    assert.deepEqual(agreed.project.milestones.map(item => item.payment), [3500, 6000]);
    assert.equal(agreed.project.milestones[0].status, "active");
    assert.equal(agreed.project.milestones[1].status, "locked");
    assert.equal(agreed.project.hasExplicitDependencies, true);
    assert.deepEqual(agreed.project.agreement.terms.milestones.map(item => item.dependsOn), [[], [0]]);
    assert.equal(String(agreed.project.agreement.client.actor), String(first.client));
    assert.equal(String(agreed.project.agreement.freelancer.actor), registeredFreelancer.user.id);
    assert.ok(agreed.project.agreement.client.agreedAt);
    assert.ok(agreed.project.agreement.freelancer.agreedAt);
    assert.ok((await request("GET", "/api/notifications", clientToken)).notifications.some(item => item.title === "Terms agreed; freelancer assigned"));
    assert.ok((await request("GET", "/api/notifications", freelancerToken)).notifications.some(item => item.title === "Terms agreed; project assigned"));
    await request("GET", `/api/projects/public/${first._id}`, null, null, 404);
    await nextUpdate(liveClient, "project", first._id);
    await nextUpdate(liveFreelancer, "project", first._id);
    await nextUpdate(liveFreelancer, "marketplace");
    const inbox = await request("GET", "/api/workrooms/inbox", clientToken);
    assert.equal(inbox[0].projectId, first._id);
    assert.equal(inbox[0].conversationApplicationId, initialApplicants[0]._id);
    assert.equal(inbox[0].unreadCount, 1);
    await request("GET", "/api/workrooms/inbox", null, null, 401);
    await request("GET", `/api/projects/${first._id}`, null, null, 401);

    const designId = agreed.project.milestones[0]._id;
    const implementationId = agreed.project.milestones[1]._id;
    const submitPath = `/api/projects/${first._id}/milestone/${designId}/submit`;
    await request("POST", `/api/projects/${first._id}/milestone/${designId}/request-revision`, clientToken, { feedback: "This milestone has not been submitted yet." }, 400);
    await uploadRequest("POST", submitPath, otherToken, { submittedWork: "Unauthorized upload" }, [{ name: "unauthorized.pdf", type: "application/pdf", bytes: "%PDF-1.7\nno" }], 403);
    await uploadRequest("POST", submitPath, null, { submittedWork: "Unauthenticated upload" }, [{ name: "unauthenticated.pdf", type: "application/pdf", bytes: "%PDF-1.7\nno" }], 401);
    await uploadRequest("POST", submitPath, freelancerToken, { submittedWork: "Invalid executable" }, [{ name: "report.exe", type: "application/octet-stream", bytes: "MZ" }], 400);
    await uploadRequest("POST", submitPath, freelancerToken, { submittedWork: "Oversized document" }, [{ name: "large.pdf", type: "application/pdf", bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 65) }], 413);
    const firstSubmission = await uploadRequest("POST", submitPath, freelancerToken, { submittedWork: "First design draft" }, [{ name: "../../design.pdf", type: "application/pdf", bytes: "%PDF-1.7\nfirst design" }]);
    const firstVersion = firstSubmission.project.milestones.find(item => item._id === designId).submissions[0];
    assert.equal(firstVersion.version, 1);
    assert.equal(firstVersion.author, registeredFreelancer.user.id);
    assert.equal(firstVersion.files.length, 1);
    const firstFileId = firstVersion.files[0];
    const downloadPath = `/api/workrooms/projects/${first._id}/files/${firstFileId}`;
    await downloadRequest(downloadPath, null, 401);
    await downloadRequest(downloadPath, otherToken, 403);
    const downloaded = await downloadRequest(downloadPath, clientToken);
    assert.match(downloaded.headers.get("content-disposition"), /attachment/);
    assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await downloaded.text()).startsWith("%PDF-1.7"), true);
    await downloadRequest(downloadPath, freelancerToken);
    await downloadRequest(`/api/workrooms/projects/${pageJob._id}/files/${firstFileId}`, otherToken, 403);
    await nextUpdate(liveClient, "project", first._id);
    const awaiting = await request("GET", `/api/projects/${first._id}`, clientToken);
    assert.equal(awaiting.milestones[0].submissions[0].files[0].filename, "design.pdf");
    assert.equal(awaiting.insights.awaitingReview, 1);
    assert.equal(awaiting.insights.level, "attention");
    assert.equal(awaiting.outlook.status, "needs_review");
    assert.equal(awaiting.outlook.dependenciesReliable, true);
    assert.equal(awaiting.outlook.scheduleBasis, "critical_dependency_chain");
    assert.equal(awaiting.outlook.projectedDate, null);
    assert.match(awaiting.outlook.nextAction, /client must review submitted work/i);
    assert.equal((await request("GET", "/api/workrooms/inbox", clientToken))[0].pendingAction, true);
    await request("POST", `/api/projects/${first._id}/milestone/${designId}/request-revision`, clientToken, { feedback: "Please add mobile layouts to the design." });
    assert.equal((await request("GET", "/api/workrooms/inbox", freelancerToken))[0].pendingAction, true);
    const revisionDetail = await request("GET", `/api/projects/${first._id}`, freelancerToken);
    assert.equal(String(revisionDetail.milestones[0].revisionRequests[0].submission), String(firstVersion._id));
    const openedCase = await uploadRequest("POST", `/api/workrooms/projects/${first._id}/disputes`, clientToken, { reason: "The delivery scope needs a documented discussion." }, [{ name: "context.txt", type: "text/plain", bytes: "Scope discussion context" }], 201);
    assert.equal(openedCase.status, "open");
    assert.equal(openedCase.history[0].attachments[0].filename, "context.txt");
    await request("GET", `/api/workrooms/projects/${first._id}/disputes`, null, null, 401);
    assert.equal((await request("GET", `/api/workrooms/projects/${first._id}/disputes`, freelancerToken)).length, 1);
    await request("GET", `/api/workrooms/projects/${first._id}/disputes`, otherToken, null, 403);
    await uploadRequest("POST", `/api/workrooms/disputes/${openedCase._id}/messages`, freelancerToken, {}, [{ name: "scope.txt", type: "text/plain", bytes: "Latest scope notes" }], 200);
    const caseHistory = await request("GET", `/api/workrooms/projects/${first._id}/disputes`, clientToken);
    assert.equal(caseHistory[0].history.length, 2);
    assert.equal(caseHistory[0].status, "open");
    await request("PATCH", `/api/workrooms/disputes/${openedCase._id}/resolve`, clientToken, {}, 404);
    await request("GET", "/api/admin/cases", null, null, 401);
    await request("GET", "/api/admin/cases", clientToken, null, 403);
    await request("GET", `/api/admin/cases/${openedCase._id}`, otherToken, null, 403);
    await request("GET", `/api/admin/cases/${openedCase._id}`, clientToken, null, 403);
    const adminQueue = await request("GET", "/api/admin/cases?status=open", adminOneToken);
    assert.ok(adminQueue.some(item => String(item._id) === String(openedCase._id)));
    const adminCase = await request("GET", `/api/admin/cases/${openedCase._id}`, adminOneToken);
    assert.equal(adminCase.history.length, 2);
    const caseAttachmentId = adminCase.history[0].attachments[0]._id;
    const adminCaseFile = await downloadRequest(`/api/admin/cases/${openedCase._id}/files/${caseAttachmentId}`, adminOneToken);
    assert.equal(await adminCaseFile.text(), "Scope discussion context");
    await downloadRequest(`/api/admin/cases/${openedCase._id}/files/${firstFileId}`, adminOneToken, 404);
    await downloadRequest(`/api/workrooms/projects/${first._id}/files/${caseAttachmentId}`, adminOneToken, 403);
    const projectBeforeCaseResolution = await request("GET", `/api/projects/${first._id}`, clientToken);
    await request("POST", `/api/admin/cases/${openedCase._id}/resolve`, adminOneToken, { reason: "Short" }, 400);
    await request("POST", `/api/admin/cases/${openedCase._id}/resolve`, adminOneToken, { reason: "The evidence was reviewed and the scope issue is documented." }, 200);
    const participantCases = await request("GET", `/api/workrooms/projects/${first._id}/disputes`, clientToken);
    const resolvedCase = participantCases.find(item => String(item._id) === String(openedCase._id));
    assert.equal(resolvedCase.status, "resolved");
    assert.equal(resolvedCase.resolution.reason, "The evidence was reviewed and the scope issue is documented.");
    assert.equal(resolvedCase.resolution.admin.name, "Review Admin One");
    assert.ok(resolvedCase.resolution.resolvedAt);
    assert.equal(resolvedCase.history.length, 3);
    assert.equal(resolvedCase.history[0].attachments[0].filename, "context.txt");
    assert.equal(resolvedCase.history[1].attachments[0].filename, "scope.txt");
    assert.equal(resolvedCase.history.at(-1).action, "resolved");
    await request("POST", `/api/workrooms/disputes/${openedCase._id}/messages`, freelancerToken, { text: "Trying to update a closed case." }, 409);
    await request("POST", `/api/admin/cases/${openedCase._id}/resolve`, adminTwoToken, { reason: "Second resolution attempt is not allowed." }, 409);
    const projectAfterCaseResolution = await request("GET", `/api/projects/${first._id}`, clientToken);
    assert.equal(projectAfterCaseResolution.status, projectBeforeCaseResolution.status);
    assert.equal(projectAfterCaseResolution.budget, projectBeforeCaseResolution.budget);
    assert.deepEqual(projectAfterCaseResolution.milestones.map(item => item.status), projectBeforeCaseResolution.milestones.map(item => item.status));
    assert.ok((await request("GET", "/api/notifications", clientToken)).notifications.some(item => item.title === "Project case resolved"));
    assert.ok((await request("GET", "/api/notifications", freelancerToken)).notifications.some(item => item.title === "Project case resolved"));
    const reopenedCase = await uploadRequest("POST", `/api/workrooms/projects/${first._id}/disputes`, freelancerToken, { reason: "A separate issue arose after the earlier case closed." }, [], 201);
    assert.equal(reopenedCase.status, "open");
    await uploadRequest("POST", `/api/workrooms/projects/${first._id}/disputes`, clientToken, { reason: "A duplicate open case is not allowed." }, [], 409);
    const concurrentResolutions = await Promise.all([adminOneToken, adminTwoToken].map(async token => {
      const response = await fetch(`${baseUrl}/api/admin/cases/${reopenedCase._id}/resolve`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Resolve the newly opened case after review." }),
      });
      return { status: response.status, data: await response.json() };
    }));
    assert.deepEqual(concurrentResolutions.map(item => item.status).sort(), [200, 409]);
    assert.equal((await request("GET", `/api/admin/cases/${reopenedCase._id}`, adminOneToken)).status, "resolved");
    await request("POST", `/api/projects/${first._id}/milestone/${designId}/submit`, freelancerToken, { submittedWork: "Updated design with mobile layouts" });
    const latestDetail = await request("GET", `/api/projects/${first._id}`, clientToken);
    const latestVersion = latestDetail.milestones[0].submissions[1];
    assert.equal(latestVersion.version, 2);
    await request("POST", `/api/projects/${first._id}/milestone/${designId}/approve`, clientToken, { submissionId: String(firstVersion._id) }, 409);
    await request("POST", `/api/projects/${first._id}/milestone/${designId}/approve`, clientToken, { submissionId: String(latestVersion._id) });
    let detail = await request("GET", `/api/projects/${first._id}`, freelancerToken);
    assert.deepEqual(detail.milestones.map(item => item.status), ["completed", "active"]);
    assert.equal(detail.milestones[0].submissions.length, 2);
    assert.ok(detail.activity.some(item => item.type === "revision_requested"));
    const implementationSubmission = await uploadRequest("POST", `/api/projects/${first._id}/milestone/${implementationId}/submit`, freelancerToken, {}, [{ name: "delivery.csv", type: "text/csv", bytes: "screen,ready\nmain,true" }]);
    assert.equal(implementationSubmission.project.milestones.find(item => item._id === implementationId).submissions[0].work, "");
    await request("POST", `/api/projects/${first._id}/milestone/${implementationId}/approve`, clientToken);
    detail = await request("GET", `/api/projects/${first._id}`, clientToken);
    assert.equal(detail.status, "Completed");
    assert.equal(detail.insights.level, "complete");
    assert.equal(detail.outlook.status, "complete");
    const reviewPath = `/api/reviews/project/${first._id}`;
    await request("GET", reviewPath, otherToken, null, 403);
    await request("POST", reviewPath, clientToken, { rating: 6, text: "Excellent delivery" }, 400);
    await request("POST", reviewPath, clientToken, { rating: 5, text: "Clear work and responsive delivery." }, 201);
    assert.equal((await request("GET", `/api/talent/${directory.talent[0].id}`, clientToken)).reviews.count, 0);
    assert.equal((await request("GET", reviewPath, clientToken)).other, null);
    assert.equal((await request("GET", reviewPath, freelancerToken)).other, null);
    await request("POST", reviewPath, freelancerToken, { rating: 4, text: "Clear brief and timely feedback." }, 201);
    assert.equal((await request("GET", reviewPath, clientToken)).other.rating, 4);
    await request("POST", reviewPath, clientToken, { rating: 5, text: "Trying a second review." }, 409);
    assert.deepEqual((await request("GET", "/api/talent?q=React", clientToken)).talent[0].reviews, { average: 5, count: 1 });
    const reviewedTalentProfile = await request("GET", `/api/talent/${directory.talent[0].id}`, clientToken);
    assert.equal(reviewedTalentProfile.reviews.items[0].rating, 5);
    assert.equal(reviewedTalentProfile.reviews.items[0].text, "Clear work and responsive delivery.");

    const ownProfile = await request("GET", "/api/profile/me", freelancerToken);
    assert.equal(ownProfile.trust.approvedMilestones, 2);
    assert.equal(ownProfile.trust.revisionRequests, 1);
    assert.equal(ownProfile.trust.completedProjects, 1);
    await Project.collection.insertMany(Array.from({ length: 4 }, () => ({
      _id: new mongoose.Types.ObjectId(),
      title: "Legacy project without stored client ID",
      budget: 100,
      deadline: "2030-12-31",
      freelancer: new mongoose.Types.ObjectId(registeredFreelancer.user.id),
      status: "Completed",
      milestones: [{ title: "Legacy approval", status: "completed", payment: 100, revisionCount: 0 }],
      createdAt: new Date(),
      updatedAt: new Date(),
    })));
    const profileWithLegacyWork = await request("GET", "/api/profile/me", freelancerToken);
    assert.equal(profileWithLegacyWork.trust.approvedMilestones, 6);
    assert.equal(profileWithLegacyWork.trust.scoredMilestones, 5);
    assert.equal(profileWithLegacyWork.trust.clientCount, 1);
    const talentWithLegacyWork = await request("GET", `/api/talent/${directory.talent[0].id}`, clientToken);
    assert.equal(talentWithLegacyWork.trust.approvedMilestones, 6);
    assert.equal(talentWithLegacyWork.trust.scoredMilestones, 5);
    const second = (await request("POST", "/api/projects/create", clientToken, { ...createBody, title: "Another dashboard" }, 201)).project;
    await request("POST", "/api/applications", freelancerToken, { projectId: second._id, proposal: "I can apply the same workflow to this dashboard.", proposedPrice: 5000, deliveryEstimateDays: 21 }, 201);
    const laterApplicants = await request("GET", `/api/applications/project/${second._id}`, clientToken);
    assert.equal(laterApplicants[0].trust.approvedMilestones, 6);
    assert.equal(laterApplicants[0].trust.scoredMilestones, 5);
    assert.equal(laterApplicants[0].match.trustIncluded, true);
    const laterProjectOffer = await request("POST", `/api/applications/${laterApplicants[0]._id}/offer`, clientToken, { terms: offerTerms(5000) }, 201);
    const secondAgreement = await request("POST", `/api/applications/${laterApplicants[0]._id}/offer/${laterProjectOffer.application.currentOfferId}/accept`, freelancerToken, {});
    assert.equal(secondAgreement.application.status, "ACCEPTED");

    const legacyPendingProject = (await request("POST", "/api/projects/create", clientToken, { ...createBody, title: "Legacy pending proposal", milestones: [{ title: "Delivery", payment: 10000, dependsOn: [] }] }, 201)).project;
    const legacyPendingApplication = new mongoose.Types.ObjectId();
    await Application.collection.insertOne({ _id: legacyPendingApplication, project: new mongoose.Types.ObjectId(legacyPendingProject._id), freelancer: new mongoose.Types.ObjectId(registeredOther.user.id), proposal: "Historical text-only proposal with no new hiring fields.", status: "PENDING", createdAt: new Date(), updatedAt: new Date() });
    const legacyOffer = await request("POST", `/api/applications/${legacyPendingApplication}/offer`, clientToken, { terms: offerTerms(10000) }, 201);
    assert.equal(legacyOffer.application.offers[0].version, 1);
    const legacyOfferAcceptance = await request("POST", `/api/applications/${legacyPendingApplication}/offer/${legacyOffer.application.currentOfferId}/accept`, otherToken, {});
    assert.equal(legacyOfferAcceptance.application.status, "ACCEPTED");
    const freelancerOpenedCase = await request("POST", `/api/workrooms/projects/${second._id}/disputes`, freelancerToken, { reason: "The implementation deadline needs a shared discussion." }, 201);
    assert.equal(String(freelancerOpenedCase.history[0].author._id), registeredFreelancer.user.id);
    assert.equal((await request("GET", `/api/workrooms/projects/${second._id}/disputes`, clientToken))[0].status, "open");

    const concurrentProject = (await request("POST", "/api/projects/create", clientToken, { ...createBody, title: "Concurrent assignment check", milestones: [{ title: "Delivery", payment: 10000, dependsOn: [] }] }, 201)).project;
    const concurrentApplicationA = (await request("POST", "/api/applications", freelancerToken, { projectId: concurrentProject._id, proposal: "I can deliver this project with a reviewable handoff.", proposedPrice: 10000, deliveryEstimateDays: 20 }, 201)).application;
    const concurrentApplicationB = (await request("POST", "/api/applications", otherToken, { projectId: concurrentProject._id, proposal: "I can deliver this project with a tested implementation.", proposedPrice: 9800, deliveryEstimateDays: 18 }, 201)).application;
    const concurrentOfferA = await request("POST", `/api/applications/${concurrentApplicationA._id}/offer`, clientToken, { terms: offerTerms(10000) }, 201);
    const concurrentOfferB = await request("POST", `/api/applications/${concurrentApplicationB._id}/offer`, clientToken, { terms: offerTerms(9800) }, 201);
    const concurrentAcceptances = await Promise.all([
      { applicationId: concurrentApplicationA._id, offerId: concurrentOfferA.application.currentOfferId, token: freelancerToken },
      { applicationId: concurrentApplicationB._id, offerId: concurrentOfferB.application.currentOfferId, token: otherToken },
    ].map(async item => {
      const response = await fetch(`${baseUrl}/api/applications/${item.applicationId}/offer/${item.offerId}/accept`, { method: "POST", headers: { ...authHeaders(item.token), "Content-Type": "application/json" }, body: "{}" });
      return { status: response.status, data: await response.json() };
    }));
    assert.deepEqual(concurrentAcceptances.map(item => item.status).sort(), [200, 409]);
    const concurrentWinner = concurrentAcceptances.find(item => item.status === 200).data.application;
    const concurrentDetail = await request("GET", `/api/projects/${concurrentProject._id}`, clientToken);
    assert.equal(String(concurrentDetail.freelancer._id), String(concurrentWinner.freelancer));
    assert.equal(String(concurrentDetail.agreement.application), String(concurrentWinner._id));
    const concurrentApplicants = await request("GET", `/api/applications/project/${concurrentProject._id}`, clientToken);
    assert.equal(concurrentApplicants.filter(item => item.status === "ACCEPTED").length, 1);
    assert.equal(concurrentApplicants.filter(item => item.status === "REJECTED").length, 1);

    await request("POST", "/api/projects/create", clientToken, { ...createBody, category: "Other", customCategory: " " }, 400);
    await request("POST", "/api/projects/create", clientToken, { ...createBody, category: "Other", customCategory: "x".repeat(81) }, 400);
    const customProject = (await request("POST", "/api/projects/create", clientToken, { ...createBody, title: "Review building plans", description: "Review the provided building plans and deliver clear recommendations.", category: "Other", customCategory: " Architecture " }, 201)).project;
    assert.equal(customProject.customCategory, "Architecture");
    const customDetail = await request("GET", `/api/projects/public/${customProject._id}`);
    assert.equal(customDetail.customCategory, "Architecture");
    const customSearch = await request("GET", "/api/projects/public?category=Other&q=Architecture");
    assert.equal(customSearch.projects.some(project => String(project._id) === String(customProject._id)), true);
    assert.equal(customSearch.projects.find(project => String(project._id) === String(customProject._id)).customCategory, "Architecture");

    const decimalPlan = [
      { title: "Scope", description: "Agree requirements", payment: 19.99, dependsOn: [] },
      { title: "Frontend", description: "Build screens", payment: 20.1, dependsOn: [0] },
      { title: "Backend", description: "Build API", payment: 30.1, dependsOn: [0] },
      { title: "Integration", description: "Connect and test", payment: 30.1, dependsOn: [1, 2] },
    ];
    await request("POST", "/api/projects/create", clientToken, { ...createBody, budget: 100.291 }, 400);
    await request("POST", "/api/projects/create", clientToken, { ...createBody, milestones: [{ title: "Invalid precision", payment: 1.001 }] }, 400);
    const decimalProject = (await request("POST", "/api/projects/create", clientToken, { ...createBody, title: "Parallel decimal plan", budget: 100.29, milestones: decimalPlan }, 201)).project;
    const decimalApplication = (await request("POST", "/api/applications", freelancerToken, { projectId: decimalProject._id, proposal: "Deliver both parts in parallel and integrate the result.", proposedPrice: 100.29, deliveryEstimateDays: 20 }, 201)).application;
    const decimalTerms = { scope: createBody.description, amount: 100.29, deliveryDate: "2030-12-20", milestones: decimalPlan.map(item => ({ ...item, dueDate: "2030-12-20" })) };
    for (const invalid of [[1], [0, 0], [-1]]) {
      await request("POST", `/api/applications/${decimalApplication._id}/offer`, clientToken, { terms: { ...decimalTerms, milestones: decimalTerms.milestones.map((item, index) => index === 1 ? { ...item, dependsOn: invalid } : item) } }, 400);
    }
    const decimalOffer = await request("POST", `/api/applications/${decimalApplication._id}/offer`, clientToken, { terms: decimalTerms }, 201);
    const decimalCounter = await request("POST", `/api/applications/${decimalApplication._id}/offer`, freelancerToken, { replacesOfferId: decimalOffer.application.currentOfferId, terms: { ...decimalTerms, scope: "Deliver and review the agreed frontend, backend and integration work." } }, 201);
    const decimalAgreement = await request("POST", `/api/applications/${decimalApplication._id}/offer/${decimalCounter.application.currentOfferId}/accept`, clientToken, {});
    assert.equal(decimalAgreement.project.agreement.version, 2);
    assert.deepEqual(decimalAgreement.project.agreement.terms.milestones.map(item => item.dependsOn), [[], [0], [0], [1, 2]]);
    assert.deepEqual(decimalAgreement.project.milestones.map(item => item.payment), decimalPlan.map(item => item.payment));
    assert.equal(decimalAgreement.project.milestones[3].dueDate, "2030-12-20");
    const decimalIds = decimalAgreement.project.milestones.map(item => item._id);
    assert.deepEqual(decimalAgreement.project.milestones[3].dependsOn, [decimalIds[1], decimalIds[2]]);
    await request("POST", `/api/projects/${decimalProject._id}/milestone/${decimalIds[3]}/submit`, freelancerToken, { submittedWork: "Premature integration" }, 400);
    const states = [["completed", "active", "active", "locked"], ["completed", "completed", "active", "locked"], ["completed", "completed", "completed", "active"]];
    for (let index = 0; index < 3; index++) {
      await request("POST", `/api/projects/${decimalProject._id}/milestone/${decimalIds[index]}/submit`, freelancerToken, { submittedWork: `Completed deliverable ${index + 1}` });
      await request("POST", `/api/projects/${decimalProject._id}/milestone/${decimalIds[index]}/approve`, clientToken);
      const latest = await request("GET", `/api/projects/${decimalProject._id}`, clientToken);
      assert.deepEqual(latest.milestones.map(item => item.status), states[index]);
    }

    process.env.APP_ORIGIN = baseUrl;
    process.env.RESEND_API_KEY = "test-only-key";
    process.env.RESET_FROM_EMAIL = "FreelanceChain <reset@example.test>";
    delete process.env.RESET_DELIVERY;
    assert.equal((await request("GET", "/api/auth/recovery-status")).mode, "email");
    let resetEmail;
    global.fetch = (url, options) => {
      if (url === "https://api.resend.com/emails") {
        resetEmail = JSON.parse(options.body);
        return Promise.resolve({ ok: true, status: 200 });
      }
      return originalFetch(url, options);
    };
    const unknownReset = await request("POST", "/api/auth/forgot-password", null, { email: "missing@example.test" });
    assert.equal(resetEmail, undefined);
    const knownReset = await request("POST", "/api/auth/forgot-password", null, { email: "client@example.test" });
    assert.equal(knownReset.message, unknownReset.message);
    assert.deepEqual(resetEmail.to, ["client@example.test"]);
    const firstLink = resetEmail.text.match(/https?:\/\/\S+/)[0];
    const firstToken = new URL(firstLink).searchParams.get("token");
    assert.equal(firstToken.length, 43);
    resetEmail = undefined;
    await request("POST", "/api/auth/forgot-password", null, { email: "client@example.test" });
    assert.equal(resetEmail, undefined);
    const User = require("./models/User");
    const stored = await User.findOne({ email: "client@example.test" }).select("+passwordResetTokenHash");
    assert.notEqual(stored.passwordResetTokenHash, firstToken);
    await User.updateOne({ _id: stored._id }, { $set: { passwordResetExpiresAt: new Date(Date.now() - 1000), passwordResetRequestedAt: new Date(Date.now() - 120000) } });
    await request("POST", "/api/auth/reset-password", null, { token: firstToken, password: "new-client-password" }, 400);
    await request("POST", "/api/auth/forgot-password", null, { email: "client@example.test" });
    const secondToken = new URL(resetEmail.text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
    assert.notEqual(secondToken, firstToken);
    await request("POST", "/api/auth/reset-password", null, { token: secondToken, password: "new-client-password" });
    await request("POST", "/api/auth/reset-password", null, { token: secondToken, password: "another-password" }, 400);
    await request("POST", "/api/auth/login", null, { email: "client@example.test", password, role: "client" }, 400);
    await request("GET", "/api/projects/mine", clientToken, null, 401);
    assert.ok((await request("POST", "/api/auth/login", null, { email: "client@example.test", password: "new-client-password", role: "client" })).sessionAuth);
    const unknownLogin = await request("POST", "/api/auth/login", null, { email: "unknown@example.test", password, role: "client" }, 400);
    const wrongPassword = await request("POST", "/api/auth/login", null, { email: "client@example.test", password, role: "client" }, 400);
    assert.equal(unknownLogin.message, wrongPassword.message);
    assert.equal(wrongPassword.message, "Invalid credentials");
    let limited = false;
    for (let attempt = 0; attempt < 21; attempt++) {
      const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { ...authHeaders(null), "Content-Type": "application/json" }, body: JSON.stringify({ email: "unknown@example.test", password, role: "client" }) });
      if (response.status === 429) { limited = true; break; }
      assert.equal(response.status, 400);
    }
    assert.equal(limited, true, "Repeated login attempts should be limited");
  } finally {
    liveClient?.abort.abort();
    liveFreelancer?.abort.abort();
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(priorResetEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (previousUploadDirectory === undefined) delete process.env.PRIVATE_UPLOAD_DIR; else process.env.PRIVATE_UPLOAD_DIR = previousUploadDirectory;
    if (mongoose.connection.readyState === 1 && mongoose.connection.db.databaseName === databaseName) {
      await mongoose.connection.dropDatabase();
    }
    await mongoose.disconnect();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(uploadDirectory, { recursive: true, force: true });
  }
});

