const express = require("express");
const mongoose = require("mongoose");
const Project = require("../models/Project");
const ProjectTask = require("../models/ProjectTask");
const { protect, allowRoles } = require("../middleware/authMiddleware");
const { pagination, envelope } = require("../pagination");
const { publishUser } = require("../liveUpdates");
const { assignedTasks } = require("../taskReminders");

const router = express.Router();
const boardStatuses = ["In Progress", "Completed", "Cancelled"];
const statuses = ["todo", "in_progress", "review", "done"];
const priorities = ["low", "medium", "high", "urgent"];
router.use(protect, allowRoles("freelancer"));
router.use((req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const handleError = (res, error) => res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to update the task board. Please try again." });

function pagingFor(query, taskFilters = false) {
  const allowed = ["page", "pageSize", ...(taskFilters ? ["q", "status", "priority", "due", "today"] : [])];
  if (Object.keys(query).some(key => !allowed.includes(key))) fail(400, "Invalid board query");
  return pagination(query, 50);
}
function searchFilter(query) {
  const text = (key, limit) => {
    if (query[key] === undefined) return "";
    if (typeof query[key] !== "string" || query[key].length > limit) fail(400, `Invalid ${key} filter`);
    return query[key].trim();
  };
  const q = text("q", 100), status = text("status", 20), priority = text("priority", 10), due = text("due", 10);
  const today = text("today", 10) || new Date().toISOString().slice(0, 10);
  const day = new Date(`${today}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== today) fail(400, "Invalid board date");
  if (status && !statuses.includes(status)) fail(400, "Invalid status filter");
  if (priority && !priorities.includes(priority)) fail(400, "Invalid priority filter");
  if (due && due !== "overdue") fail(400, "Invalid due date filter");
  const filter = {};
  if (q) {
    const literal = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ title: literal }, { description: literal }, { "checklist.title": literal }];
  }
  if (priority) filter.priority = priority;
  if (status) filter.status = status;
  if (due) {
    filter.dueDate = { $gt: "", $lt: today };
    filter.status = status === "done" ? { $in: [] } : status || { $ne: "done" };
  }
  return { filter, today };
}
async function ownProject(req, writable = false) {
  if (!mongoose.isObjectIdOrHexString(req.params.projectId)) fail(404, "Task board not found");
  const project = await Project.findOne({ _id: req.params.projectId, freelancer: req.user._id, status: { $in: boardStatuses } })
    .select("title status deadline milestones._id milestones.title milestones.status").lean();
  if (!project) fail(404, "Task board not found. Boards are available for your assigned projects.");
  if (writable && project.status !== "In Progress") fail(409, "This project has ended. Its task board is read-only.");
  return project;
}
function taskView(task) {
  return { _id: task._id, title: task.title, description: task.description, status: task.status, priority: task.priority, dueDate: task.dueDate, milestoneId: task.milestoneId, checklist: task.checklist || [], reminderAt: task.reminderAt || null, reminderSentAt: task.reminderSentAt || null, activity: task.activity || [], version: task.__v, createdAt: task.createdAt, updatedAt: task.updatedAt };
}
function taskFields(body, project, editing = false, current = null) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "Enter task details");
  const allowed = ["title", "description", "status", "priority", "dueDate", "milestoneId", "checklist", "reminderAt", ...(editing ? ["version"] : [])];
  if (Object.keys(body).some(key => !allowed.includes(key))) fail(400, "Invalid task field");
  const fields = {};
  const text = (key, maximum, required) => {
    if (!Object.hasOwn(body, key)) { if (required && !editing) fail(400, "Enter a task title"); return; }
    if (typeof body[key] !== "string" || body[key].trim().length > maximum || (required && !body[key].trim())) fail(400, key === "title" ? "Enter a task title of 1–120 characters" : "Task description must be up to 4000 characters");
    fields[key] = body[key].trim();
  };
  text("title", 120, true); text("description", 4000, false);
  for (const [key, values] of [["status", statuses], ["priority", priorities]]) {
    if (Object.hasOwn(body, key)) { if (!values.includes(body[key])) fail(400, `Invalid task ${key}`); fields[key] = body[key]; }
  }
  if (Object.hasOwn(body, "dueDate")) {
    const value = body.dueDate;
    if (typeof value !== "string") fail(400, "Enter a valid task due date");
    if (value) {
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(400, "Enter a valid task due date");
    }
    fields.dueDate = value;
  }
  if (Object.hasOwn(body, "milestoneId")) {
    const value = body.milestoneId;
    if (value !== null && value !== "" && (typeof value !== "string" || !project.milestones.some(item => String(item._id) === value))) fail(400, "Choose a milestone from this project");
    fields.milestoneId = value || null;
  }
  if (Object.hasOwn(body, "checklist")) {
    if (!Array.isArray(body.checklist) || body.checklist.length > 30) fail(400, "Add up to 30 subtasks per task");
    const ids = new Set();
    fields.checklist = body.checklist.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["_id", "title", "done"].includes(key))) fail(400, "Invalid subtask details");
      if (typeof item.title !== "string" || !item.title.trim() || item.title.trim().length > 160) fail(400, "Give each subtask a title of 1–160 characters");
      if (item.done !== undefined && typeof item.done !== "boolean") fail(400, "Invalid subtask completion value");
      if (item._id !== undefined) {
        if (typeof item._id !== "string" || !current?.checklist?.some(saved => String(saved._id) === item._id) || ids.has(item._id)) fail(400, "Load the latest subtasks before saving");
        ids.add(item._id);
      }
      return { ...(item._id ? { _id: item._id } : {}), title: item.title.trim(), done: item.done || false };
    });
  }
  if (Object.hasOwn(body, "reminderAt")) {
    const value = body.reminderAt;
    const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ? new Date(value) : null;
    if (value !== null && (!date || Number.isNaN(date.getTime()) || date.toISOString() !== value.replace(/Z$/, value.includes(".") ? "Z" : ".000Z"))) fail(400, "Enter a valid reminder time");
    const unchanged = (date?.getTime() || null) === (current?.reminderAt ? new Date(current.reminderAt).getTime() : null);
    if (!unchanged && date && date <= new Date()) fail(400, "Choose a reminder time in the future");
    if (!unchanged) {
      fields.reminderAt = date; fields.reminderSentAt = null;
      fields.reminderToken = date ? new mongoose.Types.ObjectId() : null;
    }
  }
  if ((fields.status || current?.status) === "done") {
    if (fields.reminderAt) fail(400, "Done tasks cannot have a reminder. Clear it before saving.");
    if (current?.reminderAt) { fields.reminderAt = null; fields.reminderToken = null; fields.reminderSentAt = null; }
  }
  if (editing && (!Number.isSafeInteger(body.version) || body.version < 0)) fail(400, "Load the latest task before saving");
  if (editing && !Object.keys(fields).length) fail(400, "Choose a task detail to update");
  return fields;
}

router.get("/", async (req, res) => {
  try {
    const paging = pagingFor(req.query);
    const filter = { freelancer: req.user._id, status: { $in: boardStatuses } };
    const [items, total] = await Promise.all([
      Project.find(filter).select("title status deadline").sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.pageSize).lean(),
      Project.countDocuments(filter),
    ]);
    res.json(envelope(items, total, paging));
  } catch (error) { handleError(res, error); }
});
router.get("/mine", async (req, res) => {
  try {
    if (Object.keys(req.query).some(key => !["page", "pageSize", "q", "priority", "today", "view"].includes(key))) fail(400, "Invalid tasks query");
    const paging = pagination(req.query, 20);
    const search = searchFilter(req.query);
    const view = req.query.view === undefined ? "open" : req.query.view;
    if (typeof view !== "string" || !["open", "today", "upcoming", "overdue", "done"].includes(view)) fail(400, "Invalid task view");
    const filters = {
      open: { status: { $ne: "done" } },
      today: { status: { $ne: "done" }, dueDate: search.today },
      upcoming: { status: { $ne: "done" }, dueDate: { $gt: search.today } },
      overdue: { status: { $ne: "done" }, dueDate: { $gt: "", $lt: search.today } },
      done: { status: "done" },
    };
    const base = [...assignedTasks(req.user._id), { $match: search.filter }];
    const [result] = await ProjectTask.aggregate([...base, { $facet: {
      items: [{ $match: filters[view] }, { $addFields: { undated: { $cond: [{ $eq: ["$dueDate", ""] }, 1, 0] } } },
        { $sort: { undated: 1, dueDate: 1, _id: 1 } }, { $skip: paging.skip }, { $limit: paging.pageSize }],
      ...Object.fromEntries(Object.entries(filters).map(([key, filter]) => [key, [{ $match: filter }, { $count: "count" }]])),
    } }]);
    const counts = Object.fromEntries(Object.keys(filters).map(key => [key, result[key][0]?.count || 0]));
    const items = result.items.map(task => ({ ...taskView(task), project: { _id: task.projectInfo._id, title: task.projectInfo.title } }));
    res.json(envelope(items, counts[view], paging, { counts, today: search.today }));
  } catch (error) { handleError(res, error); }
});
router.get("/:projectId/tasks/:taskId", async (req, res) => {
  try {
    const project = await ownProject(req);
    if (!mongoose.isObjectIdOrHexString(req.params.taskId)) fail(404, "Task not found");
    const task = await ProjectTask.findOne({ _id: req.params.taskId, project: project._id, owner: req.user._id }).lean();
    if (!task) fail(404, "Task not found");
    res.json({ task: taskView(task) });
  } catch (error) { handleError(res, error); }
});
router.get("/:projectId", async (req, res) => {
  try {
    const paging = pagingFor(req.query, true);
    const search = searchFilter(req.query);
    const project = await ownProject(req);
    const base = { project: project._id, owner: req.user._id };
    const filter = { ...base, ...search.filter };
    const [tasks, groups, summaries] = await Promise.all([
      ProjectTask.find(filter).sort({ createdAt: 1, _id: 1 }).skip(paging.skip).limit(paging.pageSize).lean(),
      ProjectTask.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      ProjectTask.aggregate([{ $match: base }, { $group: {
        _id: null, total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } },
        overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "done"] }, { $gt: ["$dueDate", ""] }, { $lt: ["$dueDate", search.today] }] }, 1, 0] } },
      } }]),
    ]);
    const counts = Object.fromEntries(statuses.map(status => [status, groups.find(item => item._id === status)?.count || 0]));
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const summary = summaries[0] || { total: 0, done: 0, overdue: 0 }; delete summary._id;
    res.json(envelope(tasks.map(taskView), total, paging, { project: { ...project, editable: project.status === "In Progress" }, counts, summary, today: search.today }));
  } catch (error) { handleError(res, error); }
});
router.post("/:projectId/tasks", async (req, res) => {
  try {
    const project = await ownProject(req, true);
    const fields = taskFields(req.body, project);
    const task = await ProjectTask.create({ ...fields, project: project._id, owner: req.user._id, activity: [{ at: new Date(), summary: "Task created." }] });
    publishUser(req.user._id, "tasks", project._id);
    res.status(201).json({ task: taskView(task) });
  } catch (error) { handleError(res, error); }
});
router.patch("/:projectId/tasks/:taskId", async (req, res) => {
  try {
    const project = await ownProject(req, true);
    if (!mongoose.isObjectIdOrHexString(req.params.taskId)) fail(404, "Task not found");
    const filter = { _id: req.params.taskId, project: project._id, owner: req.user._id };
    const current = await ProjectTask.findOne(filter).lean();
    if (!current) fail(404, "Task not found");
    if (!Number.isSafeInteger(req.body?.version) || req.body.version < 0) fail(400, "Load the latest task before saving");
    if (current.__v !== req.body.version) fail(409, "This task changed in another tab. Refresh the board before editing again. Your unsaved edits are still in the form.");
    const fields = taskFields(req.body, project, true, current);
    const labels = { title: "title", description: "description", status: "status", priority: "priority", dueDate: "due date", milestoneId: "linked milestone", checklist: "subtasks", reminderAt: "reminder" };
    const comparable = (key, value) => key === "reminderAt" ? (value ? new Date(value).toISOString() : null) : key === "milestoneId" ? String(value || "") : value;
    const changes = Object.keys(labels).filter(key => Object.hasOwn(fields, key) && JSON.stringify(comparable(key, current[key] ?? (key === "checklist" ? [] : null))) !== JSON.stringify(comparable(key, fields[key])));
    const statusNames = { todo: "To do", in_progress: "In progress", review: "Review", done: "Done" };
    const summary = changes.includes("status") ? `Status: ${statusNames[current.status]} → ${statusNames[fields.status]}.${changes.length > 1 ? " Updated " + changes.filter(key => key !== "status").map(key => labels[key]).join(", ") + "." : ""}` : `Updated ${changes.map(key => labels[key]).join(", ")}.`;
    const update = { $set: fields, $inc: { __v: 1 }, ...(changes.length ? { $push: { activity: { $each: [{ at: new Date(), summary }], $slice: -100 } } } : {}) };
    const task = await ProjectTask.findOneAndUpdate({ ...filter, __v: req.body.version }, update, { returnDocument: "after", runValidators: true }).lean();
    if (!task) {
      if (await ProjectTask.exists(filter)) fail(409, "This task changed in another tab. Close the editor and refresh the board before editing again. Your draft has been kept here.");
      fail(404, "Task not found");
    }
    publishUser(req.user._id, "tasks", project._id);
    res.json({ task: taskView(task) });
  } catch (error) { handleError(res, error); }
});
module.exports = router;
