const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  form: { type: mongoose.Schema.Types.Mixed, required: true },
  state: { type: String, enum: ["draft", "publishing", "published"], default: "draft" },
  publishedProject: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
}, { timestamps: true });
schema.index({ client: 1, state: 1, updatedAt: -1 });
module.exports = mongoose.model("ProjectDraft", schema);
