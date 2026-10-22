const mongoose = require("mongoose");
const history = new mongoose.Schema({
  action: { type: String, enum: ["suspend", "restore", "hide", "show"], required: true },
  admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  adminName: { type: String, required: true },
  reason: { type: String, required: true, maxlength: 1000 },
  at: { type: Date, default: Date.now },
});
module.exports = () => ({ moderationVersion: { type: Number, default: 0 }, moderationReason: { type: String, default: "" }, moderationHistory: { type: [history], default: [], select: false } });
