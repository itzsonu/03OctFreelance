const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  version: { type: Number, required: true },
  expiresAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("Session", schema);
