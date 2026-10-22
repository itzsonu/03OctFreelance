const express = require("express");
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const { protect } = require("../middleware/authMiddleware");
const { publishUser } = require("../liveUpdates");

const router = express.Router();
router.use(protect);

router.get("/", async (req, res) => {
  const user = req.user._id;
  const [notifications, unreadCount] = await Promise.all([
    Notification.find({ user }).select("type title body link readAt createdAt").sort({ createdAt: -1 }).limit(30).lean(),
    Notification.countDocuments({ user, readAt: null }),
  ]);
  res.json({ notifications, unreadCount });
});

router.patch("/read-all", async (req, res) => {
  await Notification.updateMany({ user: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  publishUser(req.user._id, "notifications");
  res.json({ unreadCount: 0 });
});

router.patch("/:notificationId/read", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.notificationId)) return res.status(400).json({ message: "Invalid notification" });
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.notificationId, user: req.user._id, readAt: null },
    { $set: { readAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!notification) return res.status(404).json({ message: "Notification not found or already read" });
  publishUser(req.user._id, "notifications");
  res.json({ id: notification._id, readAt: notification.readAt });
});

module.exports = router;
