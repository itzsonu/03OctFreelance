const express = require("express");
const mongoose = require("mongoose");
const Project = require("../models/Project");
const Dispute = require("../models/Dispute");
const Attachment = require("../models/Attachment");
const { protect, allowRoles } = require("../middleware/authMiddleware");
const { publishProject } = require("../liveUpdates");
const { notifyUser } = require("../notifications");
const { readFile } = require("../fileStorage");
const { pagination, listResponse } = require("../pagination");

const router = express.Router();
router.use(protect, allowRoles("admin"));
router.get("/operations", (_req, res) => res.json(require("../observability").snapshot()));
router.use(require("./supportRoutes").adminRouter);
router.use(require("./storageRoutes"));
router.use(require("./adminModerationRoutes"));

function casePopulation(query) {
  return query
    .populate({ path: "project", select: "title status client freelancer", populate: [{ path: "client", select: "name" }, { path: "freelancer", select: "name" }] })
    .populate("history.author", "name role")
    .populate("history.attachments", "filename mimeType size")
    .populate("resolution.admin", "name role");
}

router.get("/cases", async (req, res) => {
  try {
  const paging = pagination(req.query);
  const status = req.query.status || "open";
  if (!["open", "resolved", "all"].includes(status)) return res.status(400).json({ message: "Choose open, resolved or all cases" });
  const filter = status === "all" ? {} : { status };
  const cases = await casePopulation(Dispute.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(paging.skip).limit(paging.pageSize)).lean();
  listResponse(res, cases.map(item => ({
    _id: item._id,
    project: item.project,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    historyCount: item.history.length,
    resolution: item.resolution,
  })), await Dispute.countDocuments(filter), paging);
  } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load cases" }); }
});

router.get("/cases/:caseId/files/:fileId", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.caseId) || !mongoose.Types.ObjectId.isValid(req.params.fileId)) return res.status(404).json({ message: "File not found" });
  const dispute = await Dispute.findById(req.params.caseId).select("project history.attachments").lean();
  if (!dispute) return res.status(404).json({ message: "File not found" });
  const attachedToCase = (dispute.history || []).some(item => (item.attachments || []).some(id => String(id) === req.params.fileId));
  if (!attachedToCase) return res.status(404).json({ message: "File not found" });
  const attachment = await Attachment.findOne({ _id: req.params.fileId, project: dispute.project }).select("+storageKey +storageBackend filename mimeType size").lean();
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
});

router.get("/cases/:caseId", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.caseId)) return res.status(404).json({ message: "Case not found" });
  const dispute = await casePopulation(Dispute.findById(req.params.caseId)).lean();
  if (!dispute) return res.status(404).json({ message: "Case not found" });
  res.json(dispute);
});

router.post("/cases/:caseId/resolve", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.caseId)) return res.status(404).json({ message: "Case not found" });
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 10 || reason.length > 2000) return res.status(400).json({ message: "Resolution reason must be 10–2000 characters" });
  const resolvedAt = new Date();
  const dispute = await Dispute.findOneAndUpdate(
    { _id: req.params.caseId, status: "open" },
    {
      $set: { status: "resolved", resolution: { admin: req.user._id, reason, resolvedAt } },
      $push: { history: { author: req.user._id, action: "resolved", text: reason, attachments: [], createdAt: resolvedAt } },
    },
    { returnDocument: "after", runValidators: true }
  );
  if (!dispute) {
    const exists = await Dispute.exists({ _id: req.params.caseId });
    return res.status(exists ? 409 : 404).json({ message: exists ? "This case has already been resolved" : "Case not found" });
  }
  const project = await Project.findById(dispute.project).select("title client freelancer");
  if (project) {
    publishProject(project);
    await Promise.all([
      notifyUser(project.client, "case", "Project case resolved", `An admin resolved the case for ${project.title}. The reason and history are available in the project workroom.`, `/milestones/${project._id}`),
      notifyUser(project.freelancer, "case", "Project case resolved", `An admin resolved the case for ${project.title}. The reason and history are available in the project workroom.`, `/milestones/${project._id}`),
    ]);
  }
  const populated = await casePopulation(Dispute.findById(dispute._id)).lean();
  return res.json(populated);
});

module.exports = router;
