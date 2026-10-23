const express = require("express");
const mongoose = require("mongoose");
const Project = require("../models/Project");
const ProjectTask = require("../models/ProjectTask");
const { protect, allowRoles } = require("../middleware/authMiddleware");
const { pagination, envelope } = require("../pagination");

const router = express.Router();
const boardStatuses = ["In Progress", "Completed", "Cancelled"];
const statuses = ["todo", "in_progress", "review", "done"];
const priorities = ["low", "medium", "high", "urgent"];
router.use(protect, allowRoles("freelancer"));
router.use((req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const handleError = (res, error) => res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to update the task board. Please try again." });

function pagingFor(query) {
  if (Object.keys(query).some(key => !["page", "pageSize"].includes(key))) fail(400, "Invalid board query");
  return pagination(query, 50);
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
  return { _id: task._id, title: task.title, description: task.description, status: task.status, priority: task.priority, dueDate: task.dueDate, milestoneId: task.milestoneId, version: task.__v, createdAt: task.createdAt, updatedAt: task.updatedAt };
}
function taskFields(body, project, editing = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail(400, "Enter task details");
  const allowed = ["title", "description", "status", "priority", "dueDate", "milestoneId", ...(editing ? ["version"] : [])];
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
router.get("/:projectId", async (req, res) => {
  try {
    const paging = pagingFor(req.query);
    const project = await ownProject(req);
    const filter = { project: project._id, owner: req.user._id };
    const [tasks, total] = await Promise.all([
      ProjectTask.find(filter).sort({ createdAt: 1, _id: 1 }).skip(paging.skip).limit(paging.pageSize).lean(),
      ProjectTask.countDocuments(filter),
    ]);
    res.json(envelope(tasks.map(taskView), total, paging, { project: { ...project, editable: project.status === "In Progress" } }));
  } catch (error) { handleError(res, error); }
});
router.post("/:projectId/tasks", async (req, res) => {
  try {
    const project = await ownProject(req, true);
    const fields = taskFields(req.body, project);
    const task = await ProjectTask.create({ ...fields, project: project._id, owner: req.user._id });
    res.status(201).json({ task: taskView(task) });
  } catch (error) { handleError(res, error); }
});
router.patch("/:projectId/tasks/:taskId", async (req, res) => {
  try {
    const project = await ownProject(req, true);
    if (!mongoose.isObjectIdOrHexString(req.params.taskId)) fail(404, "Task not found");
    const fields = taskFields(req.body, project, true);
    const filter = { _id: req.params.taskId, project: project._id, owner: req.user._id };
    const task = await ProjectTask.findOneAndUpdate({ ...filter, __v: req.body.version }, { $set: fields, $inc: { __v: 1 } }, { returnDocument: "after", runValidators: true }).lean();
    if (!task) {
      if (await ProjectTask.exists(filter)) fail(409, "This task changed in another tab. Close the editor and refresh the board before editing again. Your draft has been kept here.");
      fail(404, "Task not found");
    }
    res.json({ task: taskView(task) });
  } catch (error) { handleError(res, error); }
});
module.exports = router;
