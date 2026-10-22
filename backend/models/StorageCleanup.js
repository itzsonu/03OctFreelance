const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  tokenHash: { type: String, required: true, select: false },
  candidates: { type: [String], select: false },
  expiresAt: Date,
  appliedAt: Date,
  status: { type: String, default: "preview" },
  removedFiles: { type: Number, default: 0 },
  releasedReservations: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
}, { timestamps: true });
module.exports = mongoose.model("StorageCleanup", schema);
