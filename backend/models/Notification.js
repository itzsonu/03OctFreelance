const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  type: { type: String, enum: ["application", "invitation", "message", "milestone", "review", "case", "support"], required: true },
  title: { type: String, required: true, maxlength: 100 },
  body: { type: String, required: true, maxlength: 240 },
  link: { type: String, required: true, maxlength: 200 },
  readAt: { type: Date, default: null },
  emailCategory: { type: String, enum: ["proposals", "offers", "submissions", "revisions"] },
  emailStatus: { type: String, enum: ["pending", "sending", "sent", "skipped", "failed"] },
  emailAttempts: { type: Number, default: 0 },
  emailNextAttemptAt: Date,
  emailLeaseUntil: Date,
  emailSentAt: Date,
  emailDeliveryMode: { type: String, enum: ["email", "local-console"] },
}, { timestamps: true });

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ emailStatus: 1, emailNextAttemptAt: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
