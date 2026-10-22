const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  kind: { type: String, enum: ["support", "deletion"], required: true },
  email: { type: String, required: true, maxlength: 254 },
  subject: { type: String, required: true, maxlength: 120 },
  message: { type: String, required: true, maxlength: 4000 },
  trackingHash: { type: String, select: false },
  status: { type: String, enum: ["open", "reviewing", "closed", "cancelled"], default: "open" },
  active: { type: Boolean, default: true },
  history: [{ actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, status: String, response: { type: String, maxlength: 4000 }, createdAt: { type: Date, default: Date.now } }],
}, { timestamps: true });
schema.index({ owner: 1, kind: 1 }, { unique: true, partialFilterExpression: { kind: "deletion", active: true } });
schema.index({ owner: 1, createdAt: -1, _id: -1 });
schema.index({ status: 1, kind: 1, updatedAt: -1, _id: -1 });
schema.index({ trackingHash: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model("SupportRequest", schema);
