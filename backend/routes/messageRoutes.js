const express = require("express");
const mongoose = require("mongoose");
const Application = require("../models/Application");
const Message = require("../models/Message");
const Attachment = require("../models/Attachment");
const { protect } = require("../middleware/authMiddleware");
const { publishUser } = require("../liveUpdates");
const { notifyUser } = require("../notifications");
const { parseFiles, validateFile, storeFile, removeFile } = require("../fileStorage");

const router = express.Router();
router.use(protect);

async function conversation(req, res, next) {
  if (!mongoose.Types.ObjectId.isValid(req.params.applicationId)) return res.status(400).json({ message: "Invalid application" });
  const application = await Application.findById(req.params.applicationId).select("project freelancer status").populate("project", "client freelancer status title");
  if (!application?.project) return res.status(404).json({ message: "Conversation not found" });
  const userId = req.user._id.toString();
  const clientId = application.project.client?.toString();
  const freelancerId = application.freelancer?.toString();
  if (userId !== clientId && userId !== freelancerId) return res.status(403).json({ message: "Access denied" });
  if (application.project.freelancer && (String(application.project.freelancer) !== freelancerId || application.status !== "ACCEPTED")) return res.status(403).json({ message: "Access denied" });
  req.conversation = { application, recipientId: userId === clientId ? freelancerId : clientId };
  next();
}

async function saveAttachments(application, user, files) {
  const saved = [];
  try {
    for (const file of files || []) {
      if (!validateFile(file)) {
        const error = new Error("Unsupported or invalid file content");
        error.status = 400;
        throw error;
      }
      const stored = await storeFile(file);
      try { saved.push(await Attachment.create({ project: application.project._id, uploader: user._id, ...stored })); }
      catch (error) { await removeFile(stored.storageKey); throw error; }
    }
    return saved;
  } catch (error) {
    await Promise.all(saved.map(item => removeFile(item.storageKey)));
    if (saved.length) await Attachment.deleteMany({ _id: { $in: saved.map(item => item._id) } });
    throw error;
  }
}

const attachmentView = attachment => ({ id: attachment._id, filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.size });

router.get("/application/:applicationId", conversation, async (req, res) => {
  await Message.updateMany({ application: req.conversation.application._id, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } }, { $addToSet: { readBy: req.user._id } });
  const messages = await Message.find({ application: req.conversation.application._id })
    .select("sender body attachments createdAt").populate("attachments", "filename mimeType size").sort({ createdAt: -1 }).limit(100).lean();
  res.json(messages.reverse().map(message => ({ id: message._id, senderId: message.sender, body: message.body, attachments: (message.attachments || []).map(attachmentView), createdAt: message.createdAt })));
});

router.post("/application/:applicationId", conversation, parseFiles, async (req, res) => {
  try {
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if ((!body && !req.files?.length) || body.length > 2000) return res.status(400).json({ message: "Add a message or attachment (up to 2000 characters)" });
    const attachments = await saveAttachments(req.conversation.application, req.user, req.files);
    const saved = await Message.create({ application: req.conversation.application._id, sender: req.user._id, body, attachments: attachments.map(item => item._id), readBy: [req.user._id] });
    publishUser(req.conversation.recipientId, "messages", req.conversation.application.project._id);
    await notifyUser(req.conversation.recipientId, "message", "New message", `${req.user.name || "Your project contact"} sent you a message.`, `/milestones/${req.conversation.application.project._id}`);
    res.status(201).json({ id: saved._id, senderId: saved.sender, body: saved.body, attachments: attachments.map(attachmentView), createdAt: saved.createdAt });
  } catch (error) {
    res.status(error.status || (error.code === "INVALID_FILE" ? 400 : 500)).json({ message: error.status || error.code === "INVALID_FILE" ? error.message : "Unable to send message" });
  }
});

module.exports = router;
