const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.EVENT_EMAILS_ENABLED = "false";
const User = require("./models/User");
const Project = require("./models/Project");
const Application = require("./models/Application");
const { testSession, authHeaders } = require("./testSession");
const app = require("./app");

test("cold-start profile setup, relevant discovery and history filtering", async t => {
  const database = `freelancechain_cold_start_test_${crypto.randomBytes(8).toString("hex")}`;
  let server;
  try {
    await mongoose.connect(`${process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017"}/${database}`, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Project.init(), Application.init()]);
    async function person(name, role, profile = {}, extra = {}) {
      const user = await User.create({ name, role, email: `${name}@example.test`, password: "unused-test-hash", profile, ...extra });
      return { user, auth: await testSession(user) };
    }
    const client = await person("client", "client");
    const unavailableClient = await person("suspended-client", "client", {}, { suspended: true });
    const freelancer = await person("new-professional", "freelancer");
    const beginner = await person("beginner", "freelancer", { headline: "Developer", bio: "I build interfaces.", skills: ["React"], experienceYears: 0, discoverable: true });
    const established = await person("established", "freelancer", { skills: ["React"], discoverable: true });
    await person("private", "freelancer", { skills: ["React"], discoverable: false });
    await person("suspended", "freelancer", { skills: ["React"], discoverable: true }, { suspended: true });
    const makeProject = (title, fields = {}) => Project.create({ title, description: "A temporary project brief for the cold-start checks.", category: "Web Development", budget: 1000, deadline: "2035-12-31", client: client.user._id, status: "Open", requiredSkills: ["React.js"], ...fields });
    const exact = await makeProject("Older React dashboard", { createdAt: new Date("2025-01-01") });
    const partial = await makeProject("React and database dashboard", { requiredSkills: ["React", "PostgreSQL"] });
    const preferred = await makeProject("Writing project", { category: "Writing & Translation", requiredSkills: ["Writing"] });
    const applied = await makeProject("Already applied");
    await Application.create({ project: applied._id, freelancer: freelancer.user._id, proposal: "Already sent", status: "PENDING" });
    await makeProject("Hidden", { moderationHidden: true });
    await makeProject("Closed", { status: "Closed" });
    await makeProject("Expired", { deadline: "2000-01-01" });
    await makeProject("Unavailable client", { client: unavailableClient.user._id });
    for (let i = 0; i < 8; i++) await makeProject(`Unrelated newest ${i}`, { requiredSkills: ["Bookkeeping"], category: "Admin & Support" });
    await makeProject("Approved work", { status: "Completed", freelancer: established.user._id, milestones: [{ title: "Delivered", status: "completed", payment: 1000 }] });
    await makeProject("Unapproved work", { status: "In Progress", freelancer: beginner.user._id, milestones: [{ title: "Review", status: "submitted", payment: 1000 }] });
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(method, route, actor, body, expected = 200) {
      const response = await fetch(base + route, { method, headers: { ...authHeaders(actor?.auth), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json(); assert.equal(response.status, expected, `${route}: ${JSON.stringify(data)}`); return data;
    }
    const profile = { headline: "Frontend specialist", bio: "I build accessible dashboards and reusable interfaces.", skills: ["React"], preferredCategories: ["Writing & Translation"], experienceYears: 5, availability: "limited", portfolioUrl: "", portfolioItems: [], discoverable: true };
    await t.test("new accounts get honest setup guidance without fabricated recommendations or trust", async () => {
      const data = await call("GET", "/projects/recommended", freelancer);
      assert.equal(data.mode, "setup"); assert.equal(data.total, 0); assert.equal(data.setup.ready, false);
      const own = await call("GET", "/profile/me", freelancer); assert.equal(own.trust.score, null);
      await call("GET", "/projects/recommended", null, null, 401);
      await call("GET", "/projects/recommended", client, null, 403);
      await call("GET", "/projects/recommended?freelancerId=other", freelancer, null, 400);
    });
    await t.test("preferences save with no sample or reviews; invalid values cannot overwrite them", async () => {
      const saved = await call("PUT", "/profile/me", freelancer, profile);
      assert.equal(saved.setup.ready, true); assert.equal(saved.setup.completed, 3);
      assert.equal(saved.setup.steps.find(step => step.key === "samples").done, false);
      assert.equal(saved.setup.steps.find(step => step.key === "samples").optional, true);
      await call("PUT", "/profile/me", freelancer, { ...profile, preferredCategories: ["not-a-field"] }, 400);
      await call("PUT", "/profile/me", freelancer, { ...profile, preferredCategories: { x: 1 } }, 400);
      const legacyPayload = { ...profile }; delete legacyPayload.preferredCategories;
      const kept = await call("PUT", "/profile/me", freelancer, legacyPayload);
      assert.deepEqual(kept.profile.preferredCategories, profile.preferredCategories);
      assert.equal((await call("GET", "/profile/me", freelancer)).trust.score, null);
    });
    let originalIds;
    await t.test("global recommendations use aliases and preferred fields, not recency or work history", async () => {
      const first = await call("GET", "/projects/recommended?page=1&pageSize=2", freelancer);
      const second = await call("GET", "/projects/recommended?page=2&pageSize=2", freelancer);
      assert.equal(first.total, 3); assert.equal(first.pages, 2);
      originalIds = [...first.projects, ...second.projects].map(project => project._id);
      assert.deepEqual(originalIds, [String(exact._id), String(partial._id), String(preferred._id)]);
      assert.deepEqual(first.projects[0].reason.matchedSkills, ["React.js"]);
      assert.equal(second.projects[0].reason.preferredField, true);
      assert.equal(first.projects[0].client, undefined); assert.equal(first.projects[0].activity, undefined);
      await call("GET", "/projects/recommended?page=0", freelancer, null, 400);
    });
    await t.test("new talent means no approved platform work, independent of years, and filters precede pagination", async () => {
      const first = await call("GET", "/talent?history=none&skill=Reactjs&pageSize=1&page=1", client);
      const second = await call("GET", "/talent?history=none&skill=Reactjs&pageSize=1&page=2", client);
      assert.equal(first.total, 2); assert.equal(second.total, 2); assert.notEqual(first.talent[0].id, second.talent[0].id);
      const experiencedNewcomer = await call("GET", "/talent?history=none&minExperience=3", client);
      assert.equal(experiencedNewcomer.total, 1); assert.equal(experiencedNewcomer.talent[0].id, String(freelancer.user._id));
      assert.equal(experiencedNewcomer.talent[0].trust.score, null);
      const recorded = await call("GET", "/talent?history=recorded", client);
      assert.equal(recorded.total, 1); assert.equal(recorded.talent[0].id, String(established.user._id));
      await call("GET", "/talent?history=bogus", client, null, 400);
      await call("GET", "/talent?history=none", freelancer, null, 403);
    });
    await t.test("first approved work changes history eligibility without changing profile recommendations", async () => {
      await makeProject("First approval", { status: "In Progress", freelancer: freelancer.user._id, milestones: [{ title: "Plan", status: "completed", payment: 1000 }] });
      const after = await call("GET", "/projects/recommended?pageSize=10", freelancer);
      assert.deepEqual(after.projects.map(project => project._id), originalIds);
      const remaining = await call("GET", "/talent?history=none", client);
      assert.equal(remaining.total, 1); assert.equal(remaining.talent[0].id, String(beginner.user._id));
      assert.equal((await call("GET", "/profile/me", freelancer)).trust.approvedMilestones, 1);
    });
  } finally {
    if (server) { require("./liveUpdates").disconnectAll(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
