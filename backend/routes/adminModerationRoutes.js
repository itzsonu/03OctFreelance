const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Project = require("../models/Project");
const Dispute = require("../models/Dispute");
const Application = require("../models/Application");
const { pagination, envelope } = require("../pagination");
const { revokeUserSessions } = require("../sessions");
const { disconnectUser, publishUser, publishProject, publishMarketplace } = require("../liveUpdates");
const { notifyUser } = require("../notifications");
const router = express.Router();
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const route = action => async (req, res) => { try { await action(req, res); } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load or update administration records" }); } };
function search(query) {
  if (query.q === undefined) return null;
  if (typeof query.q !== "string" || query.q.length > 80) fail(400, "Search must be up to 80 characters");
  return query.q.trim() ? new RegExp(query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
}
const versionFilter = (field, value) => value === 0 ? { $or: [{ [field]: 0 }, { [field]: { $exists: false } }] } : { [field]: value };
function input(req, actions) {
  if (!mongoose.isValidObjectId(req.params.id)) fail(404, "Record not found");
  const { action, reason, version } = req.body || {};
  if (!actions.includes(action) || typeof reason !== "string" || reason.trim().length < 10 || reason.trim().length > 1000 || !Number.isInteger(version) || version < 0) fail(400, "Choose an action, add a reason of 10–1000 characters, and reload the latest record");
  return { action, reason: reason.trim(), version };
}
router.get("/overview", route(async (_req, res) => {
  const [users, clients, freelancers, suspended, activeProjects, completedProjects, openProjects, hiddenListings, pendingCases, pendingProposals] = await Promise.all([
    User.countDocuments(), User.countDocuments({ role: "client" }), User.countDocuments({ role: "freelancer" }), User.countDocuments({ suspended: true }),
    Project.countDocuments({ status: "In Progress" }), Project.countDocuments({ status: "Completed" }), Project.countDocuments({ status: "Open" }), Project.countDocuments({ moderationHidden: true }), Dispute.countDocuments({ status: "open" }), Application.countDocuments({ status: "PENDING" }),
  ]);
  res.json({ users, clients, freelancers, suspended, activeProjects, completedProjects, openProjects, hiddenListings, pendingCases, pendingProposals });
}));
router.get("/users", route(async (req, res) => {
  const paging = pagination(req.query);
  const filter = {};
  if (req.query.role) { if (!["client", "freelancer", "admin"].includes(req.query.role)) fail(400, "Invalid account role"); filter.role = req.query.role; }
  if (req.query.state) { if (!["active", "suspended"].includes(req.query.state)) fail(400, "Invalid account state"); filter.suspended = req.query.state === "suspended" ? true : { $ne: true }; }
  const q = search(req.query); if (q) filter.$or = [{ name: q }, { email: q }];
  const [items, total] = await Promise.all([User.find(filter).select("name email role suspended moderationReason moderationVersion createdAt").sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.pageSize).lean(), User.countDocuments(filter)]);
  res.json(envelope(items, total, paging));
}));
router.get("/projects", route(async (req, res) => {
  const paging = pagination(req.query); const filter = {};
  if (req.query.status) { if (!["Open", "Closed", "In Progress", "Completed", "Cancelled"].includes(req.query.status)) fail(400, "Invalid project status"); filter.status = req.query.status; }
  if (req.query.state) { if (!["visible", "hidden"].includes(req.query.state)) fail(400, "Invalid listing state"); filter.moderationHidden = req.query.state === "hidden" ? true : { $ne: true }; }
  const q = search(req.query); if (q) filter.title = q;
  const [items, total] = await Promise.all([Project.find(filter).select("title description client freelancer status budget deadline moderationHidden moderationReason moderationVersion __v createdAt").populate("client", "name").sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.pageSize).lean(), Project.countDocuments(filter)]);
  res.json(envelope(items, total, paging));
}));
router.post("/users/:id/moderation", route(async (req, res) => {
  const { action, reason, version } = input(req, ["suspend", "restore"]);
  if (String(req.user._id) === req.params.id) fail(403, "You cannot moderate your own account");
  const target = await User.findById(req.params.id).select("role");
  if (!target) fail(404, "Account not found");
  if (target.role === "admin") fail(403, "Administrator accounts cannot be suspended or changed here");
  const user = await User.findOneAndUpdate({ _id: target._id, role: { $ne: "admin" }, suspended: action === "suspend" ? { $ne: true } : true, ...versionFilter("moderationVersion", version) }, {
    $set: { suspended: action === "suspend", moderationReason: reason }, $inc: { moderationVersion: 1, tokenVersion: 1 },
    $push: { moderationHistory: { action, admin: req.user._id, adminName: req.user.name, reason } },
  }, { returnDocument: "after", runValidators: true }).select("name email role suspended moderationReason moderationVersion");
  if (!user) fail(409, "Account changed or this action is already applied. Refresh the list.");
  disconnectUser(user._id); await revokeUserSessions(user._id); publishMarketplace();
  await notifyUser(user._id, "case", action === "suspend" ? "Account suspended" : "Account access restored", reason.slice(0, 240), "/account");
  res.json({ message: action === "suspend" ? "Account suspended and existing sessions revoked." : "Account restored. The user must sign in again.", target: user });
}));
router.post("/projects/:id/moderation", route(async (req, res) => {
  const { action, reason, version } = input(req, ["hide", "show"]);
  const project = await Project.findOneAndUpdate({ _id: req.params.id, status: { $in: ["Open", "Closed"] }, freelancer: null, moderationHidden: action === "hide" ? { $ne: true } : true, ...versionFilter("__v", version) }, {
    $set: { moderationHidden: action === "hide", moderationReason: reason }, $inc: { moderationVersion: 1, listingRevision: 1, __v: 1 },
    $push: { moderationHistory: { action, admin: req.user._id, adminName: req.user.name, reason } },
  }, { returnDocument: "after", runValidators: true }).select("title client status moderationHidden moderationReason moderationVersion __v");
  if (!project) {
    const exists = await Project.exists({ _id: req.params.id });
    fail(exists ? 409 : 404, exists ? "Listing changed, is already moderated, or has assigned work. Refresh it; use case review for active work." : "Project not found");
  }
  publishProject(project); publishMarketplace(); publishUser(project.client, "applications", project._id);
  await notifyUser(project.client, "case", action === "hide" ? "Project listing hidden" : "Project listing restored", reason.slice(0, 240), `/milestones/${project._id}`);
  res.json({ message: action === "hide" ? "Listing hidden from discovery. New proposals and agreements are blocked; records are preserved." : "Listing restored to its existing hiring status. Previous offers need fresh agreement.", target: project });
}));
router.get("/moderation/:kind/:id", route(async (req, res) => {
  const Model = req.params.kind === "users" ? User : req.params.kind === "projects" ? Project : null;
  if (!Model || !mongoose.isValidObjectId(req.params.id)) fail(404, "Record not found");
  const paging = pagination(req.query, 10);
  const [record] = await Model.aggregate([{ $match: { _id: new mongoose.Types.ObjectId(req.params.id) } }, { $project: { items: { $slice: [{ $reverseArray: { $ifNull: ["$moderationHistory", []] } }, paging.skip, paging.pageSize] }, total: { $size: { $ifNull: ["$moderationHistory", []] } } } }]);
  if (!record) fail(404, "Record not found");
  res.json(envelope(record.items, record.total, paging));
}));
module.exports = router;
