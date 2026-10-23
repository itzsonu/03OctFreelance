const ProjectTask = require("./models/ProjectTask");
const Project = require("./models/Project");
const User = require("./models/User");
const Notification = require("./models/Notification");
const { publishUser } = require("./liveUpdates");

// Ownership and current assignment are both required; ended projects leave daily planning.
function assignedTasks(owner) {
  return [
    { $match: { owner } },
    { $lookup: { from: Project.collection.name, localField: "project", foreignField: "_id", as: "projectInfo" } },
    { $unwind: "$projectInfo" },
    { $match: { "projectInfo.freelancer": owner, "projectInfo.status": "In Progress" } },
  ];
}

async function notificationFilter(owner) {
  const tasks = await ProjectTask.aggregate([...assignedTasks(owner),
    { $match: { status: { $ne: "done" }, reminderToken: { $type: "objectId" } } },
    { $project: { reminderToken: 1 } },
  ]);
  return { user: owner, $or: [{ taskReminderToken: { $exists: false } }, { taskReminderToken: { $in: tasks.map(task => task.reminderToken) } }] };
}

async function processTaskReminders(now = new Date()) {
  const tasks = await ProjectTask.aggregate([
    { $match: { status: { $ne: "done" }, reminderAt: { $lte: now, $type: "date" }, reminderSentAt: null, reminderToken: { $type: "objectId" } } },
    { $lookup: { from: Project.collection.name, localField: "project", foreignField: "_id", as: "projectInfo" } },
    { $unwind: "$projectInfo" },
    { $match: { "projectInfo.status": "In Progress", $expr: { $eq: ["$owner", "$projectInfo.freelancer"] } } },
    { $lookup: { from: User.collection.name, localField: "owner", foreignField: "_id", as: "recipient" } },
    { $match: { recipient: { $elemMatch: { role: "freelancer", suspended: { $ne: true } } } } },
    { $sort: { reminderAt: 1, _id: 1 } }, { $limit: 50 },
  ]);
  let delivered = 0;
  for (const task of tasks) {
    if (!await User.exists({ _id: task.owner, role: "freelancer", suspended: { $ne: true } })) continue;
    const match = { _id: task._id, reminderToken: task.reminderToken, reminderSentAt: null, status: { $ne: "done" } };
    if (!await ProjectTask.exists(match)) continue;
    // Unique schedule token prevents duplicates on retries, restarts and concurrent servers.
    try {
      await Notification.updateOne({ taskReminderToken: task.reminderToken }, { $setOnInsert: {
        user: task.owner, type: "task", title: "Task reminder", body: `${task.title} · ${task.projectInfo.title}`.slice(0, 240),
        link: `/task-boards/${task.project}?task=${task._id}`, readAt: null,
      } }, { upsert: true, runValidators: true });
    } catch (error) { if (error.code !== 11000) throw error; }
    const result = await ProjectTask.updateOne(match, { $set: { reminderSentAt: now } });
    if (result.modifiedCount) {
      delivered++;
      publishUser(task.owner, "notifications"); publishUser(task.owner, "tasks", task.project);
    }
  }
  return delivered;
}

function startTaskReminderWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processTaskReminders(); }
    catch { console.error("Task reminders unavailable; will retry."); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 30000); timer.unref(); tick();
  return () => clearInterval(timer);
}
module.exports = { assignedTasks, notificationFilter, processTaskReminders, startTaskReminderWorker };
