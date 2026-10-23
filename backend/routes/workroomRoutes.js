const { saveAttachments } = require("../attachmentStorage");
const express = require("express");
const mongoose = require("mongoose");
const Project = require("../models/Project");
const Application = require("../models/Application");
const Attachment = require("../models/Attachment");
const Dispute = require("../models/Dispute");
const Message = require("../models/Message");
const { protect } = require("../middleware/authMiddleware");
const { publishProject } = require("../liveUpdates");
const { notifyUser } = require("../notifications");
const { parseFiles, readFile } = require("../fileStorage");
const { pagination, listResponse } = require("../pagination");

const router = express.Router();
router.use(protect);

async function participant(project, user) {
  const userId = String(user._id);
  return String(project.client) === userId || String(project.freelancer || "") === userId;
}


router.get("/inbox", async (req, res) => {
  try {
    const paging = pagination(req.query);
    const filter = req.user.role === "client" ? { client: req.user._id, freelancer: { $ne: null } } : { freelancer: req.user._id };
    const projects = await Project.find(filter).select("title status deadline milestones.status client freelancer updatedAt").sort({ updatedAt: -1, _id: -1 }).skip(paging.skip).limit(paging.pageSize).lean();
    const entries = await Promise.all(projects.map(async project => {
      const application = await Application.findOne({ project: project._id, freelancer: project.freelancer, status: "ACCEPTED" }).select("_id").lean();
      const unreadCount = application ? await Message.countDocuments({ application: application._id, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } }) : 0;
      const pendingAction = project.status === "In Progress" && project.milestones.some(item => req.user.role === "client" ? item.status === "submitted" : item.status === "revision_requested");
      const due = project.status === "In Progress" && project.deadline && new Date(`${project.deadline}T23:59:59`).getTime() < Date.now();
      return {
        projectId: project._id,
        title: project.title,
        status: project.status,
        deadline: project.deadline,
        conversationApplicationId: application?._id || null,
        unreadCount,
        pendingAction,
        overdue: Boolean(due),
        updatedAt: project.updatedAt,
      };
    }));
    listResponse(res, entries, await Project.countDocuments(filter), paging);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load project inbox" });
  }
});

router.get("/projects/:projectId/files/:fileId", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.projectId) || !mongoose.Types.ObjectId.isValid(req.params.fileId)) return res.status(404).json({ message: "File not found" });
    const project = await Project.findById(req.params.projectId).select("client freelancer").lean();
    if (!project) return res.status(404).json({ message: "File not found" });
    if (!await participant(project, req.user)) return res.status(403).json({ message: "Access denied" });
    const attachment = await Attachment.findOne({ _id: req.params.fileId, project: project._id }).select("+storageKey +storageBackend filename mimeType").lean();
    if (!attachment) return res.status(404).json({ message: "File not found" });
    const bytes = await readFile(attachment.storageKey, attachment.storageBackend || "local");
    if (!bytes) return res.status(404).json({ message: "File not found" });
    const safeName = attachment.filename.replace(/[\r\n"\\]/g, "_");
    res.set({
      "Content-Type": attachment.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    return res.send(bytes);
  } catch (error) {
    return res.status(500).json({ message: "Unable to download file" });
  }
});

router.get("/projects/:projectId/disputes", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) return res.status(404).json({ message: "Project not found" });
  const project = await Project.findById(req.params.projectId).select("client freelancer").lean();
  if (!project) return res.status(404).json({ message: "Project not found" });
  if (!await participant(project, req.user)) return res.status(403).json({ message: "Access denied" });
  const cases = await Dispute.find({ project: project._id })
    .populate("history.author", "name")
    .populate("history.attachments", "filename mimeType size")
    .populate("resolution.admin", "name role")
    .sort({ createdAt: -1 }).lean();
  res.json(cases);
});

router.post("/projects/:projectId/disputes", parseFiles, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) return res.status(404).json({ message: "Project not found" });
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (reason.length < 10 || reason.length > 2000) return res.status(400).json({ message: "Give a reason of 10–2000 characters" });
    const project = await Project.findById(req.params.projectId);
    if (!project) return res.status(404).json({ message: "Project not found" });
    if (!await participant(project, req.user)) return res.status(403).json({ message: "Access denied" });
    if (project.status !== "In Progress") return res.status(409).json({ message: "Cases can be opened only for active projects" });
    if (await Dispute.exists({ project: project._id, status: "open" })) return res.status(409).json({ message: "An open case already exists for this project" });
    const attachments = await saveAttachments(project, req.user, req.files);
    const dispute = await Dispute.create({
      project: project._id,
      history: [{ author: req.user._id, action: "opened", text: reason, attachments: attachments.map(item => item._id) }],
    });
    project.activity.push({ type: "case_opened", actor: req.user._id, actorName: req.user.name || "Project participant", note: "A project case was opened" });
    await project.save();
    publishProject(project);
    const other = String(project.client) === String(req.user._id) ? project.freelancer : project.client;
    await notifyUser(other, "milestone", "Project case opened", `A participant opened a case for ${project.title}.`, `/milestones/${project._id}`);
    const populated = await Dispute.findById(dispute._id).populate("history.author", "name").populate("history.attachments", "filename mimeType size").populate("resolution.admin", "name role").lean();
    res.status(201).json(populated);
  } catch (error) {
    res.status(error.status || (error.code === 11000 ? 409 : 500)).json({ message: error.status ? error.message : error.code === 11000 ? "An open case already exists for this project" : "Unable to open case" });
  }
});

router.post("/disputes/:disputeId/messages", parseFiles, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.disputeId)) return res.status(404).json({ message: "Case not found" });
    const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
    if ((!text && !req.files?.length) || text.length > 2000) return res.status(400).json({ message: "Add a message or evidence (up to 2000 characters)" });
    const dispute = await Dispute.findById(req.params.disputeId);
    if (!dispute) return res.status(404).json({ message: "Case not found" });
    const project = await Project.findById(dispute.project);
    if (!project) return res.status(404).json({ message: "Project not found" });
    if (!await participant(project, req.user)) return res.status(403).json({ message: "Access denied" });
    if (dispute.status !== "open") return res.status(409).json({ message: "This case is not open for updates" });
    const attachments = await saveAttachments(project, req.user, req.files);
    dispute.history.push({ author: req.user._id, action: "message", text, attachments: attachments.map(item => item._id) });
    await dispute.save();
    project.activity.push({ type: "case_updated", actor: req.user._id, actorName: req.user.name || "Project participant", note: "A project case was updated" });
    await project.save();
    publishProject(project);
    const other = String(project.client) === String(req.user._id) ? project.freelancer : project.client;
    await notifyUser(other, "milestone", "Project case updated", `A participant added information to the case for ${project.title}.`, `/milestones/${project._id}`);
    const populated = await Dispute.findById(dispute._id).populate("history.author", "name").populate("history.attachments", "filename mimeType size").populate("resolution.admin", "name role").lean();
    res.status(200).json(populated);
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to update case" });
  }
});

module.exports = router;
