const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.EVENT_EMAILS_ENABLED = "false";
const User = require("./models/User");
const Project = require("./models/Project");
const ProjectTask = require("./models/ProjectTask");
const Notification = require("./models/Notification");
const { processTaskReminders } = require("./taskReminders");
const { testSession, authHeaders } = require("./testSession");
const app = require("./app");

test("daily private tasks, history and durable reminders", async t => {
  const database = `freelancechain_task_daily_test_${crypto.randomBytes(8).toString("hex")}`;
  let server;
  try {
    await mongoose.connect(`${process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017"}/${database}`, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Project.init(), ProjectTask.init(), Notification.init()]);
    async function person(name, role) {
      const user = await User.create({ name, role, email: `${name}@example.test`, password: "unused-test-hash" });
      return { user, auth: await testSession(user) };
    }
    const client = await person("client", "client"), owner = await person("owner", "freelancer"), other = await person("other", "freelancer");
    const makeProject = (title, fields = {}) => Project.create({ title, description: "Fictional task planning.", client: client.user._id, freelancer: owner.user._id, status: "In Progress", deadline: "2035-12-31", budget: 1000, milestones: [{ title: "Deliver", status: "active", payment: 1000 }], ...fields });
    const first = await makeProject("First"), second = await makeProject("Second"), foreign = await makeProject("Foreign", { freelancer: other.user._id });
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(method, path, actor = owner, body, status = 200) {
      const response = await fetch(base + path, { method, headers: { ...authHeaders(actor?.auth), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json(); assert.equal(response.status, status, `${path}: ${JSON.stringify(result)}`); return result;
    }
    const board = `/task-boards/${first._id}`;
    await t.test("day views count/filter before paging and enforce current assignment", async () => {
      const tasks = await ProjectTask.insertMany([
        { title: "Daily overdue", dueDate: "2030-03-09", project: first._id },
        { title: "Daily today first", dueDate: "2030-03-10", project: first._id },
        { title: "Daily today second", dueDate: "2030-03-10", project: second._id },
        { title: "Daily future", dueDate: "2030-03-11", project: second._id },
        { title: "Daily undated", project: first._id },
        { title: "Daily done", dueDate: "2030-03-01", project: first._id, status: "done" },
      ].map(item => ({ ...item, owner: owner.user._id, priority: "high" })));
      await ProjectTask.create({ title: "Daily forbidden", project: foreign._id, owner: other.user._id, dueDate: "2030-03-09", priority: "high" });
      const path = "/task-boards/mine?today=2030-03-10&q=Daily&priority=high";
      const open = await call("GET", path + "&pageSize=2");
      assert.deepEqual(open.counts, { open: 5, today: 2, upcoming: 1, overdue: 1, done: 1 });
      assert.equal(open.total, 5); assert.equal(open.pages, 3); assert.equal(open.items.length, 2);
      assert.equal(open.items[0].title, "Daily overdue"); assert.deepEqual(Object.keys(open.items[0].project).sort(), ["_id", "title"]);
      assert.equal("owner" in open.items[0], false); assert.equal("reminderToken" in open.items[0], false);
      assert.equal((await call("GET", path + "&pageSize=2&page=3")).items[0].title, "Daily undated");
      for (const [view, count] of [["today", 2], ["upcoming", 1], ["overdue", 1], ["done", 1]]) assert.equal((await call("GET", path + "&view=" + view)).total, count);
      assert.equal((await call("GET", path.replace("q=Daily", "q=not-present"))).total, 0);
      for (const query of ["view=invalid", "view[x]=today", "today=2030-02-30", "owner=other"]) await call("GET", "/task-boards/mine?" + query, owner, undefined, 400);
      await call("GET", path, client, undefined, 403);
      const direct = await call("GET", `${board}/tasks/${tasks[4]._id}`); assert.equal(direct.task.title, "Daily undated");
      await call("GET", `${board}/tasks/${tasks[4]._id}`, other, undefined, 404);
      await Project.updateOne({ _id: second._id }, { $set: { status: "Completed" } });
      assert.equal((await call("GET", path)).total, 3);
      await Project.updateOne({ _id: first._id }, { $set: { freelancer: other.user._id } });
      assert.equal((await call("GET", path)).total, 0);
      assert.equal((await call("GET", path, other)).items.some(item => item.title === "Daily overdue"), false);
      await Project.updateOne({ _id: first._id }, { $set: { freelancer: owner.user._id } });
    });
    await t.test("history is server generated, bounded and atomic with stale-write rejection", async () => {
      let task = (await call("POST", board + "/tasks", owner, { title: "Activity task" }, 201)).task;
      assert.equal(task.activity.length, 1);
      task = (await call("PATCH", board + "/tasks/" + task._id, owner, { status: "in_progress", version: 0 })).task;
      assert.match(task.activity.at(-1).summary, /To do → In progress/);
      await call("PATCH", board + "/tasks/" + task._id, owner, { status: "done", version: 0 }, 409);
      await call("PATCH", board + "/tasks/" + task._id, owner, { activity: [], version: 1 }, 400);
      assert.equal((await call("GET", board + "/tasks/" + task._id)).task.activity.length, 2);
      await ProjectTask.updateOne({ _id: task._id }, { $set: { activity: Array.from({ length: 100 }, () => ({ at: new Date(), summary: "Earlier change" })) } });
      task = (await call("PATCH", board + "/tasks/" + task._id, owner, { title: "New private title", version: 1 })).task;
      assert.equal(task.activity.length, 100); assert.equal(task.activity.at(-1).summary, "Updated title.");
      assert.equal(JSON.stringify(task.activity).includes("New private title"), false);
      await ProjectTask.updateOne({ _id: task._id }, { $unset: { activity: 1 } });
      assert.deepEqual((await call("GET", board + "/tasks/" + task._id)).task.activity, []);
    });
    await t.test("reminders validate instants, survive retries, hide obsolete schedules and never email", async () => {
      for (const reminderAt of [true, {}, "", "2030-02-30T10:00:00.000Z", "2000-01-01T00:00:00.000Z"]) await call("POST", board + "/tasks", owner, { title: "Bad reminder", reminderAt }, 400);
      const when = new Date(Date.now() + 60000);
      let task = (await call("POST", board + "/tasks", owner, { title: "Remember delivery", reminderAt: when.toISOString() }, 201)).task;
      const path = board + "/tasks/" + task._id;
      await Promise.all([processTaskReminders(new Date(+when + 1)), processTaskReminders(new Date(+when + 1))]);
      assert.equal(await Notification.countDocuments({ type: "task" }), 1);
      let inbox = await call("GET", "/notifications"); assert.equal(inbox.unreadCount, 1);
      assert.match(inbox.notifications[0].link, new RegExp("task=" + task._id));
      assert.equal((await Notification.findOne({ type: "task" }).lean()).emailStatus, undefined);
      assert.equal((await call("GET", "/notifications", client)).unreadCount, 0);
      const note = inbox.notifications[0]._id;
      await call("PATCH", "/notifications/" + note + "/read"); await call("PATCH", "/notifications/" + note + "/read");
      task = (await call("GET", path)).task; assert.ok(task.reminderSentAt);
      const next = new Date(+when + 60000);
      task = (await call("PATCH", path, owner, { reminderAt: next.toISOString(), version: task.version })).task;
      assert.equal(task.reminderSentAt, null); assert.equal((await call("GET", "/notifications")).notifications.length, 0);
      await processTaskReminders(new Date(+next + 1)); assert.equal((await call("GET", "/notifications")).unreadCount, 1);
      task = (await call("PATCH", path, owner, { status: "done", version: task.version })).task;
      assert.equal(task.reminderAt, null); assert.equal((await call("GET", "/notifications")).unreadCount, 0);
      task = (await call("PATCH", path, owner, { status: "todo", version: task.version })).task;
      assert.equal(task.reminderAt, null); assert.equal(await processTaskReminders(new Date(+next + 60000)), 0);
      task = (await call("PATCH", path, owner, { reminderAt: next.toISOString(), version: task.version })).task;
      await Project.updateOne({ _id: first._id }, { $set: { freelancer: other.user._id } });
      assert.equal(await processTaskReminders(new Date(+next + 1)), 0);
      await Project.updateOne({ _id: first._id }, { $set: { freelancer: owner.user._id, status: "Cancelled" } });
      assert.equal(await processTaskReminders(new Date(+next + 1)), 0);
      await Project.updateOne({ _id: first._id }, { $set: { status: "In Progress" } });
      await User.updateOne({ _id: owner.user._id }, { $set: { suspended: true } });
      assert.equal(await processTaskReminders(new Date(+next + 1)), 0);
      await User.updateOne({ _id: owner.user._id }, { $set: { suspended: false } });
      // Simulate process restart after notification creation, before task acknowledgement.
      const stored = await ProjectTask.findById(task._id).lean();
      await Notification.create({ user: owner.user._id, type: "task", title: "Task reminder", body: "Already saved", link: "/", taskReminderToken: stored.reminderToken });
      assert.equal(await processTaskReminders(new Date(+next + 1)), 1);
      assert.equal(await Notification.countDocuments({ taskReminderToken: stored.reminderToken }), 1);
      await ProjectTask.updateOne({ _id: task._id }, { $set: { reminderAt: new Date("2000-01-01T00:00:00.000Z") } });
      task = (await call("GET", path)).task;
      await call("PATCH", path, owner, { title: "Unchanged delivered schedule", reminderAt: task.reminderAt, version: task.version });
    });
  } finally {
    if (server) { require("./liveUpdates").disconnectAll(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
