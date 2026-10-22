const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const Project = require("./models/Project");
const Application = require("./models/Application");
const Message = require("./models/Message");
const { testSession, authHeaders } = require("./testSession");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.EVENT_EMAILS_ENABLED = "false";
const app = require("./app");

test("administration, listing restrictions and complete paginated histories", async t => {
  const database = `freelancechain_admin_test_${crypto.randomBytes(8).toString("hex")}`;
  let server;
  try {
    await mongoose.connect(`${process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017"}/${database}`, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Project.init(), Application.init(), Message.init()]);
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const password = "test-only-password"; const hash = await bcrypt.hash(password, 4);
    async function person(role, name) { const user = await User.create({ name, role, email: `${name}@example.test`, password: hash, profile: { skills: ["React"], discoverable: true } }); return { user, auth: await testSession(user) }; }
    const admin = await person("admin", "admin"); const otherAdmin = await person("admin", "secondadmin");
    const client = await person("client", "client"); const stranger = await person("client", "stranger"); const freelancer = await person("freelancer", "freelancer");
    async function call(method, path, actor, body, expected = 200) {
      const response = await fetch(base + path, { method, headers: { ...authHeaders(actor?.auth), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json(); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`); return data;
    }
    const stamp = new Date("2030-01-01T00:00:00Z");
    const jobs = await Project.insertMany(Array.from({ length: 27 }, (_, i) => ({ title: `Project ${i}`, client: client.user._id, status: "Open", category: "Web Development", description: "Build an accessible React website with clear review stages.", requiredSkills: ["React"], budget: 1000, deadline: "2035-12-31", milestones: [{ title: "Delivery", payment: 1000, status: "active" }], createdAt: stamp })));
    const active = await Project.create({ title: "Assigned project", client: client.user._id, freelancer: freelancer.user._id, status: "In Progress", budget: 1000, deadline: "2035-12-31", milestones: [{ title: "Submitted work", status: "submitted", payment: 1000 }] });
    const accepted = await Application.create({ project: active._id, freelancer: freelancer.user._id, proposal: "Original accepted proposal", status: "ACCEPTED" });
    const applicants = await User.insertMany(Array.from({ length: 25 }, (_, i) => ({ name: `Applicant ${i}`, email: `applicant${i}@example.test`, role: "freelancer", password: hash, profile: { skills: i % 2 ? ["React"] : ["Writing"], experienceYears: 2 } })));
    await Application.insertMany(applicants.map((user, i) => ({ project: jobs[0]._id, freelancer: user._id, proposal: "Build a React website with reviewable work.", proposedPrice: 800, deliveryEstimateDays: 10, shortlisted: i < 2, createdAt: stamp })));
    await Application.insertMany(jobs.slice(1, 24).map(job => ({ project: job._id, freelancer: freelancer.user._id, proposal: "I can deliver this project.", status: "PENDING", createdAt: stamp })));
    const messageStamp = new Date("2030-02-01T00:00:00Z");
    await Message.insertMany(Array.from({ length: 150 }, (_, i) => ({ application: accepted._id, sender: client.user._id, body: `Message ${i}`, createdAt: messageStamp, readBy: [client.user._id] })));
    await t.test("only admins see overview, accounts and moderation history", async () => {
      for (const actor of [client, freelancer]) {
        await call("GET", "/admin/overview", actor, null, 403);
        await call("GET", "/admin/users?page=1", actor, null, 403);
        await call("POST", `/admin/projects/${jobs[0]._id}/moderation`, actor, { action: "hide", reason: "This must require administrator access.", version: 0 }, 403);
        await call("GET", `/admin/moderation/users/${client.user._id}`, actor, null, 403);
      }
      const totals = await call("GET", "/admin/overview", admin);
      assert.equal(totals.users, 30); assert.equal(totals.activeProjects, 1); assert.equal(totals.openProjects, 27);
      const users = await call("GET", "/admin/users?page=2&pageSize=5", admin);
      assert.equal(users.total, 30); assert.equal(users.items.length, 5);
      assert.ok(users.items.every(item => !item.password && !item.tokenVersion && !item.emailChangeTokenHash));
      await call("GET", "/admin/users?page=0", admin, null, 400);
    });
    await t.test("project pages have stable ties and global workspace totals", async () => {
      const first = await call("GET", "/projects/mine?page=1&pageSize=5", client);
      const second = await call("GET", "/projects/mine?page=2&pageSize=5", client);
      assert.equal(first.total, 28); assert.equal(first.summary.active, 1); assert.equal(first.summary.waiting, 1);
      assert.equal(first.items.length, 5); assert.equal(second.items.length, 5);
      const ids = new Set(first.items.map(item => item._id)); assert.ok(second.items.every(item => !ids.has(item._id)));
      assert.deepEqual((await call("GET", "/projects/mine?page=2&pageSize=5", client)).items.map(item => item._id), second.items.map(item => item._id));
      assert.equal((await call("GET", "/projects/mine", client)).length, 20);
      assert.equal((await call("GET", "/projects/mine?page=1", stranger)).total, 0);
      await call("GET", "/projects/mine?pageSize=51", client, null, 400);
      const assigned = await call("GET", "/projects/all?view=assigned&page=1&pageSize=5", freelancer);
      assert.equal(assigned.total, 1); assert.equal(assigned.summary.open, 27); assert.equal(assigned.summary.active, 1);
    });
    await t.test("applicant ranking and filters cover all pages; private application pages stay scoped", async () => {
      const first = await call("GET", `/applications/project/${jobs[0]._id}?page=1&pageSize=5`, client);
      const second = await call("GET", `/applications/project/${jobs[0]._id}?page=2&pageSize=5`, client);
      assert.equal(first.total, 25); assert.equal(first.summary.shortlisted, 2);
      assert.ok(second.items.every(item => !first.items.some(prior => prior._id === item._id)));
      assert.equal((await call("GET", `/applications/project/${jobs[0]._id}?page=1&shortlisted=true`, client)).total, 2);
      assert.equal((await call("GET", "/applications/mine?page=2&pageSize=5", freelancer)).total, 24);
      await call("GET", `/applications/project/${jobs[0]._id}?page=2`, stranger, null, 403);
      await call("GET", `/applications/project/${jobs[0]._id}?page=-1`, client, null, 400);
    });
    await t.test("all 150 old messages remain reachable; only loaded messages become read", async () => {
      const initial = await call("GET", `/messages/application/${accepted._id}?limit=30`, freelancer);
      assert.equal(initial.messages.length, 30); assert.equal(initial.hasOlder, true);
      assert.equal(await Message.countDocuments({ application: accepted._id, readBy: { $ne: freelancer.user._id } }), 120);
      const ids = new Set(initial.messages.map(item => item.id)); let result = initial;
      while (result.hasOlder) { result = await call("GET", `/messages/application/${accepted._id}?limit=30&before=${result.beforeCursor}`, freelancer); for (const item of result.messages) { assert.ok(!ids.has(item.id)); ids.add(item.id); } }
      assert.equal(ids.size, 150);
      await Message.insertMany(Array.from({ length: 65 }, (_, i) => ({ application: accepted._id, sender: client.user._id, body: `New ${i}`, createdAt: new Date(messageStamp.getTime() + 1000) })));
      let after = initial.afterCursor; let newer = 0;
      do { result = await call("GET", `/messages/application/${accepted._id}?limit=30&after=${after}`, freelancer); after = result.afterCursor; newer += result.messages.length; for (const item of result.messages) assert.ok(!ids.has(item.id)); } while (result.hasMore);
      assert.equal(newer, 65);
      await call("GET", `/messages/application/${accepted._id}?before=invalid`, freelancer, null, 400);
      await call("GET", `/messages/application/${accepted._id}?before=${initial.beforeCursor}&after=${after}`, freelancer, null, 400);
      await call("GET", `/messages/application/${accepted._id}?limit=10`, stranger, null, 403);
    });
    await t.test("hidden listings block discovery, invitations and hiring without removing evidence", async () => {
      const application = await Application.findOne({ project: jobs[0]._id, freelancer: applicants[0]._id });
      const candidate = { user: applicants[0], auth: await testSession(applicants[0]) };
      const offered = await call("POST", `/applications/${application._id}/offer`, client, { terms: { scope: "Deliver the agreed responsive website and source files.", amount: 1000, deliveryDate: "2035-12-31", milestones: [{ title: "Delivery", payment: 1000, dependsOn: [] }] } }, 201);
      const before = await Project.findById(jobs[0]._id).lean();
      const hidden = await call("POST", `/admin/projects/${jobs[0]._id}/moderation`, admin, { action: "hide", reason: "This listing contains confirmed spam content.", version: before.__v || 0 });
      assert.equal(hidden.target.moderationHidden, true);
      await call("GET", `/projects/public/${jobs[0]._id}`, null, null, 404);
      assert.ok(!(await call("GET", "/projects/public?pageSize=50", null)).projects.some(item => item._id === String(jobs[0]._id)));
      await call("POST", `/applications/${application._id}/offer/${offered.application.currentOfferId}/accept`, candidate, {}, 409);
      await call("POST", `/projects/${jobs[0]._id}/hiring`, client, { version: hidden.target.__v, action: "reopen" }, 409);
      await call("POST", `/admin/projects/${active._id}/moderation`, admin, { action: "hide", reason: "Active agreements require separate case review.", version: active.__v }, 409);
      await call("POST", `/admin/projects/${jobs[0]._id}/moderation`, admin, { action: "show", reason: "The client corrected the listing after review.", version: before.__v || 0 }, 409);
      const restored = await call("POST", `/admin/projects/${jobs[0]._id}/moderation`, admin, { action: "show", reason: "The client corrected the listing after review.", version: hidden.target.__v });
      assert.equal(restored.target.status, before.status);
      await call("POST", `/applications/${application._id}/offer/${offered.application.currentOfferId}/accept`, candidate, {}, 409);
      assert.deepEqual((await Project.findById(jobs[0]._id).lean()).milestones, before.milestones);
      assert.equal(await Application.countDocuments({ project: jobs[0]._id }), 25);
      const audit = await call("GET", `/admin/moderation/projects/${jobs[0]._id}?page=1&pageSize=1`, admin);
      assert.equal(audit.total, 2); assert.equal(audit.items[0].action, "show"); assert.equal(audit.items[0].adminName, "admin");
    });
    await t.test("suspension blocks sessions, login and owned listings; restoration cannot revive old sessions", async () => {
      await call("POST", `/admin/users/${admin.user._id}/moderation`, admin, { action: "suspend", reason: "Self suspension must always be rejected.", version: 0 }, 403);
      await call("POST", `/admin/users/${otherAdmin.user._id}/moderation`, admin, { action: "suspend", reason: "Administrator access cannot be removed here.", version: 0 }, 403);
      await call("POST", `/admin/users/${client.user._id}/moderation`, admin, { action: "suspend", reason: "bad", version: 0 }, 400);
      const suspended = await call("POST", `/admin/users/${client.user._id}/moderation`, admin, { action: "suspend", reason: "Repeated abusive project posts require suspension.", version: 0 });
      assert.equal(suspended.target.suspended, true);
      await call("GET", "/projects/mine", client, null, 401);
      await call("POST", "/auth/login", null, { email: client.user.email, password, role: "client" }, 403);
      assert.equal((await call("GET", "/projects/public", null)).total, 0);
      await call("GET", `/projects/public/${jobs[1]._id}`, null, null, 404);
      await call("POST", `/admin/users/${client.user._id}/moderation`, admin, { action: "restore", reason: "The account was reviewed and restrictions removed.", version: 0 }, 409);
      await call("POST", `/admin/users/${client.user._id}/moderation`, admin, { action: "restore", reason: "The account was reviewed and restrictions removed.", version: suspended.target.moderationVersion });
      await call("GET", "/projects/mine", client, null, 401);
      assert.equal((await call("GET", "/projects/public", null)).total, 27);
      const audit = await call("GET", `/admin/moderation/users/${client.user._id}?page=2&pageSize=1`, admin);
      assert.equal(audit.items[0].action, "suspend"); assert.equal(audit.total, 2);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
