const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, enum: ["application", "invitation", "message", "milestone", "review", "case"], required: true },
  title: { type: String, required: true, maxlength: 100 },
  body: { type: String, required: true, maxlength: 240 },
  link: { type: String, required: true, maxlength: 200 },
  readAt: { type: Date, default: null },
}, { timestamps: true });

notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
