const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  storageKey: { type: String, required: true, unique: true, select: false },
  filename: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
}, { timestamps: true });

module.exports = mongoose.model("Attachment", attachmentSchema);