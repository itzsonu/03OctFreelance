const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  application: { type: mongoose.Schema.Types.ObjectId, ref: "Application", required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  body: { type: String, default: "", trim: true, maxlength: 2000 },
  attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Attachment" }],
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, { timestamps: true });

messageSchema.index({ application: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
