const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.EVENT_EMAILS_ENABLED = "false";
const User = require("./models/User");
const Project = require("./models/Project");
const ProjectTask = require("./models/ProjectTask");
const { testSession, authHeaders } = require("./testSession");
const app = require("./app");

test("private task boards for assigned freelancers", async t => {
  const database = `freelancechain_task_board_test_${crypto.randomBytes(8).toString("hex")}`;
  let server;
  try {
    await mongoose.connect(`${process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017"}/${database}`, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Project.init(), ProjectTask.init()]);
    async function person(name, role) {
      const user = await User.create({ name, role, email: `${name}@example.test`, password: "unused-test-hash" });
      return { user, auth: await testSession(user) };
    }
    const client = await person("client", "client");
    const owner = await person("owner", "freelancer");
    const other = await person("other", "freelancer");
    const admin = await person("admin", "admin");
    const makeProject = (title, fields = {}) => Project.create({ title, description: "A fictional delivery project.", client: client.user._id, freelancer: owner.user._id, status: "In Progress", deadline: "2035-12-31", budget: 1000, milestones: [{ title: "Deliver interface", status: "active", payment: 1000 }], ...fields });
    const project = await makeProject("Main project");
    const second = await makeProject("Second project");
    const open = await makeProject("Unassigned", { freelancer: null, status: "Open" });
    const foreign = await makeProject("Other freelancer", { freelancer: other.user._id });
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(method, route, actor, body, expected = 200) {
      const response = await fetch(base + route, { method, headers: { ...authHeaders(actor?.auth), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json(); assert.equal(response.status, expected, `${route}: ${JSON.stringify(data)}`); return data;
    }
    const board = `/task-boards/${project._id}`;
    let task;
    await t.test("boards require the assigned freelancer and do not expose other projects", async () => {
      await call("GET", "/task-boards", null, undefined, 401);
      for (const actor of [client, admin]) {
        await call("GET", "/task-boards", actor, undefined, 403);
        await call("POST", `${board}/tasks`, actor, { title: "Private" }, 403);
      }
      await call("GET", board, other, undefined, 404);
      await call("POST", `${board}/tasks`, other, { title: "Intrusion" }, 404);
      await call("GET", `/task-boards/${open._id}`, owner, undefined, 404);
      const list = await call("GET", "/task-boards?page=1&pageSize=1", owner);
      assert.equal(list.total, 2); assert.equal(list.pages, 2); assert.equal(list.items.length, 1);
      assert.equal(list.items.some(item => String(item._id) === String(foreign._id)), false);
      await call("GET", "/task-boards?owner=other", owner, undefined, 400);
      await call("GET", "/task-boards/not-an-id", owner, undefined, 404);
    });
    await t.test("task details persist privately and never change milestones", async () => {
      const created = await call("POST", `${board}/tasks`, owner, { title: "Private implementation note", description: "Never publish this personal planning note.", priority: "high", dueDate: "2030-03-10", milestoneId: String(project.milestones[0]._id) }, 201);
      task = created.task;
      assert.equal(task.version, 0); assert.equal(task.status, "todo");
      const loaded = await call("GET", board, owner);
      assert.equal(loaded.items[0].description, task.description); assert.equal(loaded.items[0].milestoneId, task.milestoneId);
      assert.match((await ProjectTask.findById(task._id)).owner.toString(), new RegExp(`^${owner.user._id}$`));
      assert.equal(JSON.stringify(await call("GET", `/projects/${project._id}`, client)).includes(task.description), false);
      assert.equal(loaded.items[0].owner, undefined);
      task = (await call("PATCH", `${board}/tasks/${task._id}`, owner, { status: "done", version: task.version })).task;
      assert.equal(task.status, "done");
      const unchanged = await Project.findById(project._id);
      assert.equal(unchanged.milestones[0].status, "active"); assert.equal(unchanged.status, "In Progress");
    });
    await t.test("invalid payloads and cross-project task links cannot be saved", async () => {
      for (const body of [{ title: " " }, { title: "x".repeat(121) }, { title: "Valid", description: 3 }, { title: "Valid", priority: "invalid" }, { title: "Valid", status: "approved" }, { title: "Valid", dueDate: "2030-02-30" }, { title: "Valid", milestoneId: String(second.milestones[0]._id) }, { title: "Valid", owner: String(other.user._id) }]) await call("POST", `${board}/tasks`, owner, body, 400);
      await call("PATCH", `/task-boards/${second._id}/tasks/${task._id}`, owner, { title: "Cross-project overwrite", version: task.version }, 404);
      await call("PATCH", `${board}/tasks/${task._id}`, other, { title: "Intrusion", version: task.version }, 404);
      await call("PATCH", `${board}/tasks/${task._id}`, owner, { status: "todo" }, 400);
      assert.equal(await ProjectTask.countDocuments({ project: project._id }), 1);
    });
    await t.test("stale edits cannot overwrite a newer task version", async () => {
      const previousVersion = task.version;
      task = (await call("PATCH", `${board}/tasks/${task._id}`, owner, { title: "Reviewed implementation", priority: "urgent", dueDate: "", milestoneId: null, version: previousVersion })).task;
      await call("PATCH", `${board}/tasks/${task._id}`, owner, { title: "Old tab", version: previousVersion }, 409);
      const loaded = await call("GET", board, owner);
      assert.equal(loaded.items[0].title, "Reviewed implementation"); assert.equal(loaded.items[0].milestoneId, null); assert.equal(loaded.items[0].dueDate, "");
      await ProjectTask.insertMany(Array.from({ length: 53 }, (_, index) => ({ project: project._id, owner: owner.user._id, title: `Paged task ${index}` })));
      const first = await call("GET", `${board}?page=1&pageSize=50`, owner);
      const last = await call("GET", `${board}?page=2&pageSize=50`, owner);
      assert.equal(first.total, 54); assert.equal(first.items.length, 50); assert.equal(last.items.length, 4);
      assert.equal(new Set([...first.items, ...last.items].map(item => item._id)).size, 54);
    });
    await t.test("checklists keep stable identities, validate edits and leave parent status independent", async () => {
      const path = `/task-boards/${second._id}`;
      let item = (await call("POST", `${path}/tasks`, owner, { title: "Checklist parent", checklist: [{ title: "  First step  " }, { title: "Second step", done: false }] }, 201)).task;
      assert.equal(item.checklist[0].title, "First step"); assert.equal(item.checklist[0].done, false);
      const firstId = item.checklist[0]._id;
      item = (await call("PATCH", `${path}/tasks/${item._id}`, owner, { checklist: item.checklist.map(step => ({ ...step, done: true })), version: item.version })).task;
      assert.equal(item.checklist[0]._id, firstId); assert.equal(item.checklist.every(step => step.done), true); assert.equal(item.status, "todo");
      await call("PATCH", `${path}/tasks/${item._id}`, owner, { checklist: [], version: 0 }, 409);
      for (const checklist of [[{ title: "", done: false }], [{ title: "Step", done: "yes" }], Array.from({ length: 31 }, () => ({ title: "Too many" })), [{ _id: String(new mongoose.Types.ObjectId()), title: "Foreign step", done: true }]]) await call("POST", `${path}/tasks`, owner, { title: "Invalid checklist", checklist }, 400);
      await call("PATCH", `${path}/tasks/${item._id}`, owner, { checklist: [item.checklist[0], item.checklist[0]], version: item.version }, 400);
      item = (await call("PATCH", `${path}/tasks/${item._id}`, owner, { checklist: [{ ...item.checklist[0], title: "Renamed step" }], version: item.version })).task;
      assert.equal(item.checklist.length, 1); assert.equal(item.checklist[0]._id, firstId);
      await ProjectTask.updateOne({ _id: task._id }, { $unset: { checklist: 1 } });
      assert.deepEqual((await call("GET", board, owner)).items[0].checklist, []);
    });
    await t.test("search, filters and progress cover all private tasks before pagination", async () => {
      const path = `/task-boards/${second._id}`;
      await ProjectTask.insertMany(Array.from({ length: 51 }, (_, index) => ({ project: second._id, owner: owner.user._id, title: `Earlier filler ${index}` })));
      const special = await ProjectTask.create({ project: second._id, owner: owner.user._id, title: "Escape [UI]. work", description: "Billing review", priority: "high", status: "in_progress", dueDate: "2030-03-09", checklist: [{ title: "Confirm invoice", done: false }] });
      await ProjectTask.create({ project: second._id, owner: owner.user._id, title: "Due today", priority: "high", dueDate: "2030-03-10" });
      await ProjectTask.create({ project: second._id, owner: owner.user._id, title: "Finished past date", priority: "high", status: "done", dueDate: "2030-03-01" });
      await ProjectTask.create({ project: foreign._id, owner: other.user._id, title: "Escape [UI]. work", description: "Confirm invoice", priority: "high", dueDate: "2030-03-01" });
      const filtered = await call("GET", `${path}?priority=high&due=overdue&today=2030-03-10&pageSize=1`, owner);
      assert.equal(filtered.total, 1); assert.equal(filtered.items[0]._id, String(special._id)); assert.equal(filtered.counts.in_progress, 1);
      assert.deepEqual(filtered.summary, { total: 55, done: 1, overdue: 1 });
      const byStep = await call("GET", `${path}?q=invoice&pageSize=1`, owner); assert.equal(byStep.total, 1); assert.equal(byStep.items[0]._id, String(special._id));
      const literal = await call("GET", `${path}?q=${encodeURIComponent("Escape [UI].")}`, owner); assert.equal(literal.total, 1);
      assert.equal((await call("GET", `${path}?q=${encodeURIComponent(".*")}`, owner)).total, 0);
      const first = await call("GET", `${path}?priority=high&pageSize=1&page=1`, owner), last = await call("GET", `${path}?priority=high&pageSize=1&page=3`, owner);
      assert.equal(first.total, 3); assert.equal(last.pages, 3); assert.notEqual(first.items[0]._id, last.items[0]._id);
      assert.equal((await call("GET", `${path}?status=done&due=overdue&today=2030-03-10`, owner)).total, 0);
      for (const query of ["status=approved", "priority=invalid", "today=2030-02-30", "due=tomorrow", "q[x]=value"]) await call("GET", `${path}?${query}`, owner, undefined, 400);
      await call("GET", `${path}?q=invoice`, other, undefined, 404);
    });
    await t.test("ended projects keep readable tasks and reject mutations", async () => {
      for (const status of ["Completed", "Cancelled"]) {
        await Project.updateOne({ _id: project._id }, { $set: { status } });
        const loaded = await call("GET", board, owner); assert.equal(loaded.project.editable, false); assert.equal(loaded.total, 54);
        await call("POST", `${board}/tasks`, owner, { title: "Too late" }, 409);
        await call("PATCH", `${board}/tasks/${task._id}`, owner, { status: "todo", version: task.version }, 409);
      }
    });
    await t.test("a replacement freelancer never inherits the previous freelancer's private tasks", async () => {
      await Project.updateOne({ _id: project._id }, { $set: { freelancer: other.user._id, status: "In Progress" } });
      await call("GET", board, owner, undefined, 404);
      const loaded = await call("GET", board, other); assert.equal(loaded.total, 0);
      await call("PATCH", `${board}/tasks/${task._id}`, other, { status: "todo", version: task.version }, 404);
    });
  } finally {
    if (server) { require("./liveUpdates").disconnectAll(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
