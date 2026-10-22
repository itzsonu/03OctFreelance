const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const Project = require("./models/Project");
const { buildMilestones } = require("./workflow");
const { normalizeChange } = require("./projectChanges");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
const app = require("./app");

test("mutual project amendments and account security with real MongoDB", async t => {
  const database = `freelancechain_changes_test_${crypto.randomBytes(8).toString("hex")}`;
  const originalFetch = global.fetch;
  const names = ["APP_ORIGIN", "RESET_DELIVERY", "RESEND_API_KEY", "RESET_FROM_EMAIL"];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  let server;
  let sendFails = false;
  const messages = [];
  try {
    await mongoose.connect(`${process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017"}/${database}`, { serverSelectionTimeoutMS: 5000 });
    process.env.APP_ORIGIN = "https://freelancechain.example.test";
    delete process.env.RESET_DELIVERY;
    process.env.RESEND_API_KEY = "test-only-provider-key";
    process.env.RESET_FROM_EMAIL = "test@example.test";
    global.fetch = (url, options) => {
      if (String(url) === "https://api.resend.com/emails") { messages.push(JSON.parse(options.body)); return Promise.resolve(new Response("{}", { status: sendFails ? 500 : 200 })); }
      return originalFetch(url, options);
    };
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    let sequence = 0;
    const password = "test-password-123";
    const hash = await bcrypt.hash(password, 4);
    async function person(role = "client") {
      const user = await User.create({ name: `${role} ${++sequence}`, email: `${role}${sequence}@example.test`, password: hash, role });
      return { id: String(user._id), email: user.email, role, token: jwt.sign({ id: user._id, role, version: 0 }, process.env.JWT_SECRET, { expiresIn: "1h" }) };
    }
    async function call(method, path, user, body, expected = 200) {
      const result = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer ${user.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await result.json();
      assert.equal(result.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
      return data;
    }
    const tokenFromLastEmail = () => new URL(messages.at(-1).text.match(/https:\/\/\S+/)[0]).searchParams.get("token");
    async function fixture() {
      const client = await person(); const freelancer = await person("freelancer");
      const steps = buildMilestones([{ title: "Approved design", description: "Approved original design", payment: 300, dueDate: "2026-01-01", dependsOn: [] }, { title: "Implementation", description: "Original implementation", payment: 400, dueDate: "2030-12-20", dependsOn: [0] }, { title: "Review", description: "Final checks", payment: 300, dueDate: "2030-12-30", dependsOn: [1] }]);
      steps[0].status = "completed"; steps[0].approvedAt = new Date();
      const submissionId = new mongoose.Types.ObjectId();
      steps[1].status = "submitted"; steps[1].submittedWork = "Original submitted work"; steps[1].currentSubmission = submissionId;
      steps[1].submissions = [{ _id: submissionId, work: "Original submitted work", author: freelancer.id, files: [new mongoose.Types.ObjectId()], version: 1 }];
      const agreement = { application: new mongoose.Types.ObjectId(), offer: new mongoose.Types.ObjectId(), version: 1, terms: { scope: "The original agreed project scope.", amount: 1000, deliveryDate: "2030-12-31", milestones: [{ title: "Original delivery", payment: 1000, dependsOn: [] }] }, client: { actor: client.id, agreedAt: new Date() }, freelancer: { actor: freelancer.id, agreedAt: new Date() }, agreedAt: new Date() };
      const project = await Project.create({ title: "Amendment project", description: agreement.terms.scope, budget: 1000, deadline: "2030-12-31", client: client.id, freelancer: freelancer.id, status: "In Progress", milestones: steps, hasExplicitDependencies: true, agreement });
      const terms = { scope: "Expanded dashboard scope with additional accessible final checks.", amount: 1100, deliveryDate: "2031-01-15", milestones: project.milestones.map(step => ({ milestoneId: String(step._id), title: step.title, description: step.description, payment: step.payment, dueDate: step.dueDate, dependsOn: step.dependsOn.map(id => project.milestones.findIndex(prior => String(prior._id) === String(id))) })).concat([{ milestoneId: null, title: "Accessibility pass", description: "Extra keyboard checks", payment: 100, dueDate: "2031-01-10", dependsOn: [2] }]) };
      return { client, freelancer, project, terms };
    }
    const currentVersion = async id => (await Project.findById(id)).__v || 0;
    const mutate = async (project, path, who, body, status = 200) => call("POST", `/projects/${project._id}/${path}`, who, { version: await currentVersion(project._id), ...body }, status);

    await t.test("new terms need the other party and preserve approved work, submissions and the original agreement", async () => {
      const { client, freelancer, project, terms } = await fixture();
      const original = JSON.parse(JSON.stringify(project.toObject()));
      const pending = await mutate(project, "changes", client, { reason: "We agreed to add an accessibility review stage.", terms });
      const changeId = pending.project.pendingAmendment;
      assert.equal(pending.project.budget, 1000);
      await mutate(project, `changes/${changeId}/respond`, client, { action: "accept", response: "Self acceptance must not be allowed." }, 403);
      await mutate(project, `changes/${changeId}/respond`, await person(), { action: "accept", response: "Unrelated users cannot consent." }, 403);
      await mutate(project, "cancellations", client, { reason: "An overlapping cancellation must be rejected." }, 409);
      await call("POST", `/projects/${project._id}/milestone/${project.milestones[1]._id}/approve`, client, {}, 409);
      const accepted = await mutate(project, `changes/${changeId}/respond`, freelancer, { action: "accept", response: "I agree to the expanded scope, amount and deadline." });
      assert.equal(accepted.project.budget, 1100);
      assert.equal(accepted.project.deadline, "2031-01-15");
      assert.equal(accepted.project.description, terms.scope);
      assert.deepEqual(accepted.project.agreement, original.agreement);
      assert.deepEqual(accepted.project.milestones[0], original.milestones[0]);
      assert.deepEqual(accepted.project.milestones[1].submissions, original.milestones[1].submissions);
      assert.deepEqual(accepted.project.amendments[0].before.milestones, original.milestones);
      assert.equal(accepted.project.milestones.length, 4);
      assert.equal(accepted.project.pendingAmendment, null);
      await mutate(project, `changes/${changeId}/respond`, freelancer, { action: "accept", response: "Old approval cannot be replayed." }, 409);
    });

    await t.test("invalid work removal, changed approvals, foreign IDs and invalid schedules are rejected", async () => {
      const { client, project, terms } = await fixture();
      const input = JSON.parse(JSON.stringify(terms));
      input.milestones[0].payment = 301; input.amount++;
      assert.throws(() => normalizeChange(project, input), /Approved/);
      input.milestones[0].payment = 300; input.amount--;
      input.milestones[1].milestoneId = String(new mongoose.Types.ObjectId());
      assert.throws(() => normalizeChange(project, input), /belong/);
      input.milestones[1].milestoneId = terms.milestones[1].milestoneId;
      input.milestones[1].dependsOn = [];
      assert.throws(() => normalizeChange(project, input), /Prerequisites/);
      const removed = { ...terms, milestones: [terms.milestones[0]], amount: 300 };
      assert.throws(() => normalizeChange(project, removed), /cannot be removed/);
      await mutate(project, "changes", client, { reason: "Invalid amounts cannot be proposed.", terms: { ...terms, amount: 1100.001 } }, 400);
    });

    await t.test("decline and requester withdrawal preserve active terms; competing responses have one winner", async () => {
      const { client, freelancer, project, terms } = await fixture();
      let sent = await mutate(project, "changes", freelancer, { reason: "We should consider an additional review stage.", terms });
      await mutate(project, `changes/${sent.project.pendingAmendment}/respond`, freelancer, { action: "withdraw", response: "I withdraw these changes and will keep the original plan." });
      sent = await mutate(project, "changes", client, { reason: "Consider the proposed revised delivery plan.", terms });
      const version = await currentVersion(project._id);
      const results = await Promise.all(["accept", "decline"].map(action => fetch(`${base}/projects/${project._id}/changes/${sent.project.pendingAmendment}/respond`, { method: "POST", headers: { Authorization: `Bearer ${freelancer.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ version, action, response: "My decision on the proposed new agreement." }) })));
      assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
      const stored = await Project.findById(project._id);
      assert.equal(stored.amendments.length, 2);
      assert.equal(stored.pendingAmendment, null);
      assert.equal(stored.budget, stored.amendments[1].status === "Accepted" ? 1100 : 1000);
      await Project.updateOne({ _id: project._id }, { $set: { status: "Cancelled" } });
      await mutate(project, "changes", client, { reason: "Cancelled projects cannot receive new terms.", terms }, 409);
    });

    await t.test("password change needs the current password and revokes old tokens and recovery links", async () => {
      const user = await person();
      await User.updateOne({ _id: user.id }, { $set: { passwordResetTokenHash: "old-reset", emailChangeTokenHash: "old-email", pendingEmail: "pending@example.test" } });
      await call("POST", "/account/password", user, { currentPassword: "wrong", password: "new-password-456" }, 400);
      await call("POST", "/account/password", user, { currentPassword: password, password: "🙂".repeat(25) }, 400);
      await call("POST", "/account/password", user, { currentPassword: password, password: "new-password-456" });
      await call("GET", "/account", user, null, 401);
      const stored = await User.findById(user.id).select("+passwordResetTokenHash +emailChangeTokenHash");
      assert.equal(await bcrypt.compare("new-password-456", stored.password), true);
      assert.equal(stored.passwordResetTokenHash, undefined);
      assert.equal(stored.emailChangeTokenHash, undefined);
      const login = await call("POST", "/auth/login", null, { email: user.email, password: "new-password-456", role: user.role });
      assert.ok(login.token);
    });

    await t.test("email is unchanged before verification; confirmation is single-use and revokes every session", async () => {
      const user = await person();
      const next = `verified${sequence}@example.test`;
      await call("POST", "/account/email", user, { currentPassword: password, email: next });
      const token = tokenFromLastEmail();
      assert.match(messages.at(-1).subject, /Verify/);
      assert.match(messages.at(-1).text, /30 minutes/);
      assert.equal((await User.findById(user.id)).email, user.email);
      const info = await call("GET", "/account", user);
      assert.equal(info.pendingEmail, next);
      assert.equal(info.emailChangeTokenHash, undefined);
      await call("POST", "/account/email/confirm", null, { token });
      assert.equal((await User.findById(user.id)).email, next);
      await call("GET", "/account", user, null, 401);
      await call("POST", "/account/email/confirm", null, { token }, 400);
      await call("POST", "/auth/login", null, { email: next, password, role: user.role });
    });

    await t.test("failed, cancelled, expired and conflicting email changes cannot replace the current address", async () => {
      const user = await person();
      const other = await person();
      await call("POST", "/account/email", user, { currentPassword: password, email: other.email }, 409);
      sendFails = true;
      await call("POST", "/account/email", user, { currentPassword: password, email: `failed${sequence}@example.test` }, 503);
      assert.equal((await call("GET", "/account", user)).pendingEmail, null);
      sendFails = false;
      await call("POST", "/account/email", user, { currentPassword: password, email: `cancelled${sequence}@example.test` });
      const token = tokenFromLastEmail();
      await call("DELETE", "/account/email", user);
      await call("POST", "/account/email/confirm", null, { token }, 400);
      await call("POST", "/account/email", user, { currentPassword: password, email: `expired${sequence}@example.test` });
      const expired = tokenFromLastEmail();
      await User.updateOne({ _id: user.id }, { $set: { emailChangeExpiresAt: new Date(0) } });
      await call("POST", "/account/email/confirm", null, { token: expired }, 400);
      assert.equal((await User.findById(user.id)).email, user.email);
    });

    await t.test("logout-all revokes two devices, pending links and existing live connections", async () => {
      const user = await person();
      const second = { ...user, token: jwt.sign({ id: user.id, role: user.role, version: 0 }, process.env.JWT_SECRET) };
      const controller = new AbortController();
      const stream = await originalFetch(`${base}/updates`, { headers: { Authorization: `Bearer ${second.token}` }, signal: controller.signal });
      const reader = stream.body.getReader();
      await reader.read();
      await call("POST", "/account/email", user, { currentPassword: password, email: `logout${sequence}@example.test` });
      const token = tokenFromLastEmail();
      await call("POST", "/account/logout-all", user, { currentPassword: password });
      await call("GET", "/account", user, null, 401);
      await call("GET", "/account", second, null, 401);
      const ended = await Promise.race([reader.read(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Live connection did not end")), 2000); timer.unref(); })]);
      assert.equal(ended.done, true); controller.abort();
      await call("POST", "/account/email/confirm", null, { token }, 400);
    });
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    if (mongoose.connection.readyState === 1 && mongoose.connection.db.databaseName === database && /^freelancechain_changes_test_[a-f0-9]{16}$/.test(database)) await mongoose.connection.dropDatabase();
    await mongoose.disconnect(); if (server) await new Promise(resolve => server.close(resolve));
  }
});
