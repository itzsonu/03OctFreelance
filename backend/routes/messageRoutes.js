const { saveAttachments } = require("../attachmentStorage");
const express = require("express");
const mongoose = require("mongoose");
const Application = require("../models/Application");
const Message = require("../models/Message");
const { protect } = require("../middleware/authMiddleware");
const { publishUser } = require("../liveUpdates");
const { notifyUser } = require("../notifications");
const { parseFiles } = require("../fileStorage");
const cursor = require("../messageCursor");

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


const attachmentView = attachment => ({ id: attachment._id, filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.size });

router.get("/application/:applicationId", conversation, async (req, res) => {
  try {
    const explicit = req.query.limit !== undefined || req.query.before !== undefined || req.query.after !== undefined;
    const size = req.query.limit === undefined ? 30 : Number(req.query.limit);
    if (req.query.limit !== undefined && (typeof req.query.limit !== "string" || !/^[1-9]\d*$/.test(req.query.limit))) throw new Error("Invalid message page size");
    if (!Number.isInteger(size) || size < 1 || size > 50 || (req.query.before !== undefined && req.query.after !== undefined)) throw new Error("Invalid message pagination");
    const after = req.query.after !== undefined;
    const value = after ? req.query.after : req.query.before;
    const filter = { application: req.conversation.application._id };
    if (value !== undefined) {
      const boundary = cursor.decode(value); const op = after ? "$gt" : "$lt";
      filter.$or = [{ createdAt: { [op]: boundary.createdAt } }, { createdAt: boundary.createdAt, _id: { [op]: boundary.id } }];
    }
    const direction = after ? 1 : -1;
    const records = await Message.find(filter).select("sender body attachments createdAt").populate("attachments", "filename mimeType size").sort({ createdAt: direction, _id: direction }).limit(size + 1).lean();
    const hasMore = records.length > size;
    const shown = records.slice(0, size); if (!after) shown.reverse();
    await Message.updateMany({ _id: { $in: shown.map(item => item._id) }, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } }, { $addToSet: { readBy: req.user._id } });
    const messages = shown.map(message => ({ id: message._id, senderId: message.sender, body: message.body, attachments: (message.attachments || []).map(attachmentView), createdAt: message.createdAt }));
    res.json(explicit ? { messages, hasOlder: !after && hasMore, hasMore: after && hasMore, beforeCursor: cursor.encode(shown[0]), afterCursor: cursor.encode(shown.at(-1)) || (after ? value : null) } : messages);
  } catch (error) { res.status(error.message.startsWith("Invalid message") ? 400 : 500).json({ message: error.message.startsWith("Invalid message") ? error.message : "Unable to load messages" }); }
});

router.post("/application/:applicationId", conversation, parseFiles, async (req, res) => {
  try {
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if ((!body && !req.files?.length) || body.length > 2000) return res.status(400).json({ message: "Add a message or attachment (up to 2000 characters)" });
    const attachments = await saveAttachments(req.conversation.application.project, req.user, req.files);
    const saved = await Message.create({ application: req.conversation.application._id, sender: req.user._id, body, attachments: attachments.map(item => item._id), readBy: [req.user._id] });
    publishUser(req.conversation.recipientId, "messages", req.conversation.application.project._id);
    await notifyUser(req.conversation.recipientId, "message", "New message", `${req.user.name || "Your project contact"} sent you a message.`, `/milestones/${req.conversation.application.project._id}`);
    res.status(201).json({ id: saved._id, senderId: saved.sender, body: saved.body, attachments: attachments.map(attachmentView), createdAt: saved.createdAt });
  } catch (error) {
    res.status(error.status || (error.code === "INVALID_FILE" ? 400 : 500)).json({ message: error.status || error.code === "INVALID_FILE" ? error.message : "Unable to send message" });
  }
});

module.exports = router;
