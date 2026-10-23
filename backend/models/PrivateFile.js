const mongoose = require("mongoose");
// Bytes stay outside all project/profile responses and have no public URL.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  size: { type: Number, required: true, min: 1, max: 10 * 1024 * 1024 },
  sha256: { type: String, required: true },
  data: { type: Buffer, required: true, select: false },
  createdAt: { type: Date, default: Date.now, immutable: true },
});
module.exports = mongoose.model("PrivateFile", schema);
