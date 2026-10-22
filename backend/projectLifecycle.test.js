const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const Project = require("./models/Project");
const Application = require("./models/Application");
const User = require("./models/User");
const Notification = require("./models/Notification");
const { normalizeProjectDraft } = require("./projectDraft");
const { projectInsights } = require("./insights");
const { projectOutlook } = require("./outlook");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
const app = require("./app");

test("project editing, hiring and cancellation lifecycle with real database", async t => {
  const db = `freelancechain_lifecycle_test_${crypto.randomBytes(8).toString("hex")}`;
  let server;
  try {
    await mongoose.connect(`${process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017"}/${db}`, { serverSelectionTimeoutMS: 5000 });
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const people = {};
    for (const [key, role] of [["client", "client"], ["stranger", "client"], ["freelancer", "freelancer"], ["other", "freelancer"]]) {
      const user = await User.create({ name: key, email: `${key}@example.test`, password: "test-only-hash", role });
      people[key] = { id: String(user._id), token: jwt.sign({ id: user._id, role }, process.env.JWT_SECRET) };
    }
    async function request(method, path, who, body, expected = 200) {
      const response = await fetch(base + path, { method, headers: { ...(who ? { Authorization: `Bearer ${people[who].token}` } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
      return result;
    }
    const draft = (title = "Lifecycle project") => ({ title, category: "Web Development", description: "Build a responsive project dashboard with clear delivery requirements.", requiredSkills: ["React"], budget: 1000, deadline: "2030-12-31", milestones: [{ title: "Build dashboard", description: "Deliver the interface", payment: 1000, dueDate: "2030-12-30", dependsOn: [] }] });
    const create = async () => (await request("POST", "/projects/create", "client", draft(), 201)).project;
    const version = async id => (await Project.findById(id)).__v || 0;
    const change = async (id, path, who, body, expected = 200) => request("POST", `/projects/${id}/${path}`, who, { version: await version(id), ...body }, expected);
    async function proposal(project) {
      return (await request("POST", "/applications", "freelancer", { projectId: project._id, proposal: "I can deliver a responsive and accessible interface.", proposedPrice: 1000, deliveryEstimateDays: 5 }, 201)).application;
    }
    async function offer(application) {
      return (await request("POST", `/applications/${application._id}/offer`, "client", { terms: { scope: "Deliver the agreed responsive dashboard and documented interface.", amount: 1000, deliveryDate: "2030-12-31", milestones: draft().milestones } }, 201)).application;
    }
    async function hire() {
      const project = await create();
      const applied = await proposal(project);
      const offered = await offer(applied);
      await request("POST", `/applications/${applied._id}/offer/${offered.currentOfferId}/accept`, "freelancer", {});
      return { project: await request("GET", `/projects/${project._id}`, "client"), application: applied };
    }

    await t.test("edit validates fields, keeps history and invalidates old offers", async () => {
      let project = await create();
      const applied = await proposal(project);
      const offered = await offer(applied);
      const originalMilestone = project.milestones[0]._id;
      // Existing installations may have neither revision field persisted yet.
      await Project.collection.updateOne({ _id: new mongoose.Types.ObjectId(project._id) }, { $unset: { listingRevision: "" } });
      await Application.collection.updateOne({ _id: new mongoose.Types.ObjectId(applied._id) }, { $unset: { "offers.0.listingRevision": "" } });
      await request("PATCH", `/projects/${project._id}/listing`, "stranger", { ...draft(), version: 0 }, 403);
      await request("PATCH", `/projects/${project._id}/listing`, "freelancer", { ...draft(), version: 0 }, 403);
      await request("PATCH", `/projects/${project._id}/listing`, "client", { ...draft(), budget: 0, version: 0 }, 400);
      await request("PATCH", `/projects/${project._id}/listing`, "client", { ...draft(), version: 99 }, 409);
      const edited = await request("PATCH", `/projects/${project._id}/listing`, "client", { ...draft("Updated dashboard brief"), version: 0, status: "Completed", client: people.stranger.id });
      project = edited.project;
      assert.equal(project.title, "Updated dashboard brief");
      assert.equal(project.status, "Open");
      assert.equal(String(project.client), people.client.id);
      assert.equal(project.listingRevision, 1);
      assert.equal(project.listingHistory[0].before.title, "Lifecycle project");
      assert.equal(project.listingHistory[0].before.milestones[0]._id, originalMilestone);
      const stale = await Application.findById(applied._id);
      assert.equal(stale.currentOfferState, "STALE");
      assert.equal(stale.offers[0].status, "STALE");
      await request("POST", `/applications/${applied._id}/offer/${offered.currentOfferId}/accept`, "freelancer", {}, 409);
      assert.ok(await Notification.exists({ user: people.freelancer.id, title: "Project brief updated" }));
      const fresh = await offer(applied);
      assert.equal(fresh.offers.at(-1).listingRevision, 1);
      await request("POST", `/applications/${applied._id}/offer/${fresh.currentOfferId}/accept`, "freelancer", {});
      await request("PATCH", `/projects/${project._id}/listing`, "client", { ...draft(), version: await version(project._id) }, 409);
      await change(project._id, "hiring", "client", { action: "close" }, 409);
    });

    await t.test("closed hiring disappears publicly, rejects new proposals and can reopen", async () => {
      const project = await create();
      const applied = await proposal(project);
      const offered = await offer(applied);
      await change(project._id, "hiring", "freelancer", { action: "close" }, 403);
      await change(project._id, "hiring", "client", { action: "close" });
      await request("GET", `/projects/public/${project._id}`, null, null, 404);
      const publicJobs = await request("GET", "/projects/public", null);
      assert.equal(publicJobs.projects.some(item => String(item._id) === String(project._id)), false);
      await request("POST", "/applications", "other", { projectId: project._id, proposal: "A complete responsive implementation.", proposedPrice: 1000, deliveryEstimateDays: 5 }, 409);
      await request("POST", `/applications/${applied._id}/offer/${offered.currentOfferId}/accept`, "freelancer", {}, 409);
      await request("POST", `/projects/${project._id}/hiring`, "client", { action: "reopen", version: 0 }, 409);
      await request("PATCH", `/projects/${project._id}/listing`, "client", { ...draft("Edited while closed"), version: await version(project._id) });
      assert.equal((await Project.findById(project._id)).status, "Closed");
      await change(project._id, "hiring", "client", { action: "reopen" });
      assert.equal((await request("GET", `/projects/public/${project._id}`, null)).title, "Edited while closed");
      assert.equal(await Application.countDocuments({ project: project._id }), 1);
      await Project.updateOne({ _id: project._id }, { $set: { status: "Closed", deadline: "2020-01-01" } });
      await change(project._id, "hiring", "client", { action: "reopen" }, 400);
    });

    await t.test("unassigned cancellation is terminal and retains proposals and history", async () => {
      const project = await create();
      await proposal(project);
      await change(project._id, "cancellations", "client", { reason: "short" }, 400);
      const result = await change(project._id, "cancellations", "client", { reason: "The planned project is no longer required." });
      assert.equal(result.project.status, "Cancelled");
      assert.equal(result.project.cancellationRequests[0].status, "Accepted");
      assert.equal(result.project.milestones.length, 1);
      assert.equal(await Application.countDocuments({ project: project._id }), 1);
      assert.equal(projectInsights(result.project).level, "cancelled");
      assert.equal(projectOutlook(result.project).status, "cancelled");
      await change(project._id, "hiring", "client", { action: "reopen" }, 409);
      await request("GET", `/projects/public/${project._id}`, null, null, 404);
    });

    await t.test("assigned cancellation needs the other party; decline and withdrawal resume work", async () => {
      const { project } = await hire();
      const id = project._id;
      let result = await change(id, "cancellations", "freelancer", { reason: "My availability changed and I cannot continue." });
      let pending = result.project.pendingCancellation;
      assert.equal(result.project.status, "In Progress");
      await change(id, "cancellations", "client", { reason: "Another cancellation request at the same time." }, 409);
      await request("POST", `/projects/${id}/milestone/${project.milestones[0]._id}/submit`, "freelancer", { submittedWork: "Work while cancellation is pending" }, 409);
      await change(id, `cancellations/${pending}/respond`, "freelancer", { action: "accept", response: "I approve my own cancellation request." }, 403);
      await change(id, `cancellations/${pending}/respond`, "stranger", { action: "accept", response: "A third party cannot approve this request." }, 403);
      result = await change(id, `cancellations/${pending}/respond`, "client", { action: "decline", response: "Please continue according to our agreement." });
      assert.equal(result.project.status, "In Progress");
      assert.equal(result.project.pendingCancellation, null);
      await change(id, `cancellations/${pending}/respond`, "client", { action: "accept", response: "This old request cannot be replayed." }, 409);
      result = await change(id, "cancellations", "client", { reason: "We may need to stop this project temporarily." });
      pending = result.project.pendingCancellation;
      await change(id, `cancellations/${pending}/respond`, "freelancer", { action: "withdraw", response: "The other person cannot withdraw this request." }, 403);
      await change(id, `cancellations/${pending}/respond`, "client", { action: "withdraw", response: "We can continue with the original project." });
      await request("POST", `/projects/${id}/milestone/${project.milestones[0]._id}/submit`, "freelancer", { submittedWork: "Delivery after the request was withdrawn." });
      const before = JSON.parse(JSON.stringify(await Project.findById(id).lean()));
      const oldDocument = await Project.findById(id);
      result = await change(id, "cancellations", "client", { reason: "We mutually need to end the project now." });
      pending = result.project.pendingCancellation;
      oldDocument.milestones[0].status = "completed";
      await assert.rejects(oldDocument.save(), error => error.name === "VersionError");
      result = await change(id, `cancellations/${pending}/respond`, "freelancer", { action: "accept", response: "I agree to end the project and retain its records." });
      assert.equal(result.project.status, "Cancelled");
      assert.deepEqual(result.project.agreement, before.agreement);
      assert.deepEqual(result.project.milestones, before.milestones);
      assert.equal(result.project.cancellationRequests.length, 3);
      assert.equal((await Application.findOne({ project: id })).status, "ACCEPTED");
      await request("POST", `/projects/${id}/milestone/${project.milestones[0]._id}/approve`, "client", {}, 409);
      await request("POST", `/projects/${id}/milestone/${project.milestones[0]._id}/request-revision`, "client", { feedback: "This cannot change cancelled work." }, 409);
      await request("POST", `/projects/${id}/milestone/${project.milestones[0]._id}/submit`, "freelancer", { submittedWork: "A forbidden new version after cancellation." }, 409);
      assert.equal((await request("GET", `/projects/${id}`, "freelancer")).status, "Cancelled");
    });

    await t.test("offer acceptance racing an edit or closure cannot assign stale work", async () => {
      for (const operation of ["edit", "close"]) {
        const project = await create();
        const applied = await proposal(project);
        const offered = await offer(applied);
        const editing = fetch(base + "/projects/" + project._id + (operation === "edit" ? "/listing" : "/hiring"), { method: operation === "edit" ? "PATCH" : "POST", headers: { Authorization: "Bearer " + people.client.token, "Content-Type": "application/json" }, body: JSON.stringify(operation === "edit" ? { ...draft("Changed during acceptance"), version: project.__v } : { version: project.__v, action: "close" }) });
        const accepting = fetch(base + "/applications/" + applied._id + "/offer/" + offered.currentOfferId + "/accept", { method: "POST", headers: { Authorization: "Bearer " + people.freelancer.token, "Content-Type": "application/json" }, body: "{}" });
        const [changed, accepted] = await Promise.all([editing, accepting]);
        assert.deepEqual([changed.status, accepted.status].sort(), [200, 409]);
        const stored = await Project.findById(project._id);
        const storedApplication = await Application.findById(applied._id);
        if (changed.status === 200) {
          assert.equal(stored.freelancer, null);
          assert.notEqual(storedApplication.status, "ACCEPTED");
          assert.equal(stored.status, operation === "edit" ? "Open" : "Closed");
        } else {
          assert.equal(stored.status, "In Progress");
          assert.equal(stored.title, "Lifecycle project");
          assert.equal(storedApplication.status, "ACCEPTED");
        }
      }
    });

    await t.test("competing cancellation requests have one winner and completed work stays terminal", async () => {
      const { project } = await hire();
      const body = { version: project.__v, reason: "Concurrent request to end the project by agreement." };
      const results = await Promise.all(["client", "freelancer"].map(who => fetch(`${base}/projects/${project._id}/cancellations`, { method: "POST", headers: { Authorization: `Bearer ${people[who].token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })));
      assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
      assert.equal((await Project.findById(project._id)).cancellationRequests.length, 1);
      await Project.updateOne({ _id: project._id }, { $set: { status: "Completed", pendingCancellation: null } });
      await change(project._id, "cancellations", "client", { reason: "Completed work cannot be cancelled retroactively." }, 409);
      assert.throws(() => normalizeProjectDraft({ ...draft(), milestones: [{ title: "Invalid dependency", payment: 1000, dependsOn: [0] }] }), /dependencies/);
    });
  } finally {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db.databaseName === db && /^freelancechain_lifecycle_test_[a-f0-9]{16}$/.test(db)) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
