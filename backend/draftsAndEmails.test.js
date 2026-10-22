const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { testSession, authHeaders, responseAuth } = require("./testSession");
const User = require("./models/User");
const Project = require("./models/Project");
const Draft = require("./models/ProjectDraft");
const Notification = require("./models/Notification");
const { notifyUser } = require("./notifications");
const { processEventEmails } = require("./eventEmails");
const { sendEventEmail } = require("./resetMail");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.APP_ORIGIN = "http://127.0.0.1:5000";
process.env.RESET_DELIVERY = "console";
process.env.EVENT_EMAILS_ENABLED = "false";
const app = require("./app");

test("private saved drafts, safe publication and optional event emails", async t => {
  const database = `freelancechain_medium_test_${crypto.randomBytes(8).toString("hex")}`;
  let server;
  try {
    await mongoose.connect(`${process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017"}/${database}`, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Project.init(), Draft.init(), Notification.init()]);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function person(role, name) {
      const user = await User.create({ name, role, email: `${name}@example.test`, password: "test-only-hash" });
      return { ...user.toObject(), token: await testSession(user) };
    }
    const client = await person("client", "client");
    const other = await person("client", "other");
    const freelancer = await person("freelancer", "freelancer");
    async function call(method, path, user, body, expected = 200) {
      const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...authHeaders(user?.token) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (expected !== null) assert.equal(response.status, expected, JSON.stringify(data));
      return { status: response.status, ...data };
    }
    const incomplete = { title: "Private unfinished project", description: "", category: "Other", customCategory: "", requiredSkills: "", budget: "", deadline: "", milestones: [{ title: "", description: "", payment: "", dueDate: "", dependsOn: [] }] };
    let draft;
    await t.test("incomplete drafts persist privately; strangers and freelancers cannot access them", async () => {
      draft = (await call("POST", "/project-drafts", client, { form: { ...incomplete, client: other._id, status: "Open" } }, 201)).draft;
      assert.equal(draft.client, String(client._id));
      assert.equal(draft.form.status, undefined);
      assert.equal((await call("GET", `/project-drafts/${draft._id}`, client)).draft.form.description, "");
      await call("GET", `/project-drafts/${draft._id}`, other, null, 404);
      await call("PATCH", `/project-drafts/${draft._id}`, other, { version: 0, form: incomplete }, 404);
      await call("DELETE", `/project-drafts/${draft._id}`, other, { version: 0 }, 404);
      await call("GET", "/project-drafts", freelancer, null, 403);
      await call("GET", "/project-drafts", null, null, 401);
      assert.equal((await call("GET", "/project-drafts", other)).drafts.length, 0);
      assert.equal((await call("GET", "/projects/public")).projects.length, 0);
      await call("POST", `/project-drafts/${draft._id}/publish`, client, { version: 0 }, 400);
      assert.equal(await Project.countDocuments(), 0);
    });
    await t.test("stale saves and deletes cannot overwrite work; publish retries create one project", async () => {
      const form = { ...incomplete, description: "Create an illustrated guide with original research and editable source files.", customCategory: "Marine education", requiredSkills: "Illustration, Research", budget: "1200", deadline: "2035-12-31", milestones: [{ title: "Research", description: "First draft", payment: "400", dueDate: "2035-12-10", dependsOn: [] }, { title: "Illustrations", description: "Final source files", payment: "800", dueDate: "2035-12-31", dependsOn: [0] }] };
      const saved = (await call("PATCH", `/project-drafts/${draft._id}`, client, { version: draft.__v, form })).draft;
      await call("PATCH", `/project-drafts/${draft._id}`, client, { version: draft.__v, form: incomplete }, 409);
      await call("DELETE", `/project-drafts/${draft._id}`, client, { version: draft.__v }, 409);
      assert.deepEqual((await call("GET", `/project-drafts/${draft._id}`, client)).draft.form, form);
      const results = await Promise.all([1, 2].map(() => call("POST", `/project-drafts/${draft._id}/publish`, client, { version: saved.__v }, null)));
      assert.ok(results.some(result => result.status === 200));
      assert.ok(results.every(result => [200, 409].includes(result.status)));
      const project = results.find(result => result.status === 200).project;
      const retry = await call("POST", `/project-drafts/${draft._id}/publish`, client, { version: saved.__v });
      assert.equal(retry.project._id, project._id);
      assert.equal(await Project.countDocuments(), 1);
      assert.equal(project.milestones[1].dependsOn[0], project.milestones[0]._id);
      assert.equal((await call("GET", "/project-drafts", client)).drafts.length, 0);
      const disposable = (await call("POST", "/project-drafts", client, { form: incomplete }, 201)).draft;
      await call("DELETE", `/project-drafts/${disposable._id}`, client, { version: disposable.__v });
      await call("GET", `/project-drafts/${disposable._id}`, client, null, 404);
    });
    await t.test("email choices are private, opt in and do not replace in-app notifications", async () => {
      const settings = await call("GET", "/account/notification-preferences", client);
      assert.deepEqual(settings.preferences, { proposals: false, offers: false, submissions: false, revisions: false });
      assert.equal(settings.enabled, false);
      await call("PUT", "/account/notification-preferences", client, { preferences: { proposals: "true" } }, 400);
      const preferences = { proposals: true, offers: true, submissions: true, revisions: true };
      await call("PUT", "/account/notification-preferences", client, { preferences });
      assert.equal((await call("GET", "/account/notification-preferences", other)).preferences.proposals, false);
      const disabled = await notifyUser(client._id, "application", "New proposal received", "A new proposal is ready.", "/client-dashboard", "proposals");
      assert.equal(disabled.emailStatus, "skipped");
      process.env.EVENT_EMAILS_ENABLED = "true";
      const optedOut = await notifyUser(other._id, "application", "Project offer received", "An offer is ready.", "/client-dashboard", "offers");
      assert.equal(optedOut.emailStatus, "skipped");
      assert.equal(await Notification.countDocuments(), 2);
    });
    await t.test("queued alerts survive restarts, retry failure, honor opt out and stop at three attempts", async () => {
      const pending = [];
      for (const category of ["proposals", "offers", "submissions", "revisions"]) pending.push(await notifyUser(client._id, "application", "Important project update", "Open the app to review this update.", "/client-dashboard", category));
      assert.ok(pending.every(item => item.emailStatus === "pending"));
      const sent = [];
      await processEventEmails({ send: async (email, notification) => { sent.push([email, notification.emailCategory]); return "local-console"; } });
      assert.equal(sent.length, 4);
      await processEventEmails({ send: async () => assert.fail("sent entries must not be resent") });
      const retry = await notifyUser(client._id, "milestone", "Revision requested", "Open the app.", "/client-dashboard", "revisions");
      await processEventEmails({ send: async () => { throw Error("provider outage"); } });
      assert.equal((await Notification.findById(retry._id)).emailStatus, "pending");
      await Notification.updateOne({ _id: retry._id }, { $set: { emailNextAttemptAt: new Date(0) } });
      await call("PUT", "/account/notification-preferences", client, { preferences: { proposals: true, offers: true, submissions: true, revisions: false } });
      await processEventEmails({ send: async () => assert.fail("opted-out category must not send") });
      assert.equal((await Notification.findById(retry._id)).emailStatus, "skipped");
      const abandoned = await notifyUser(client._id, "application", "Project offer received", "Open the app.", "/client-dashboard", "offers");
      await Notification.updateOne({ _id: abandoned._id }, { $set: { emailStatus: "sending", emailLeaseUntil: new Date(0), emailAttempts: 1 } });
      await processEventEmails({ send: async () => "local-console" });
      assert.equal((await Notification.findById(abandoned._id)).emailStatus, "sent");
      const failed = await notifyUser(client._id, "application", "New proposal received", "Open the app.", "/client-dashboard", "proposals");
      for (let i = 0; i < 3; i++) { await Notification.updateOne({ _id: failed._id }, { $set: { emailNextAttemptAt: new Date(0) } }); await processEventEmails({ send: async () => { throw Error("provider outage"); } }); }
      const final = await Notification.findById(failed._id);
      assert.equal(final.emailStatus, "failed"); assert.equal(final.emailAttempts, 3);
    });
    await t.test("email contains safe app links, preferences and no submitted work; Gmail is mocked", async () => {
      process.env.RESET_DELIVERY = "gmail";
      process.env.GMAIL_USER = "sender@example.test";
      process.env.GMAIL_APP_PASSWORD = "abcdefghijklmnop";
      let message;
      const notification = { _id: new mongoose.Types.ObjectId(), title: "Revision requested", body: "A client requested changes.", link: "/client-dashboard" };
      await sendEventEmail(client.email, notification, { createTransport: () => ({ sendMail: async mail => { message = mail; }, close() {} }) });
      assert.match(message.text, /\/account/);
      assert.match(message.text, /\/client-dashboard/);
      assert.equal(message.to, client.email);
      await assert.rejects(sendEventEmail(client.email, { ...notification, link: "//evil.example" }), /Invalid notification email link/);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
