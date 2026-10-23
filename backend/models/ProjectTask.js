const mongoose = require("mongoose");
const checklistItem = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  done: { type: Boolean, default: false },
});

// Kept outside Project so private planning never enters client/public project responses.
const schema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, immutable: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: "", maxlength: 4000 },
  status: { type: String, enum: ["todo", "in_progress", "review", "done"], default: "todo" },
  priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
  dueDate: { type: String, default: "" },
  milestoneId: { type: mongoose.Schema.Types.ObjectId, default: null },
  checklist: { type: [checklistItem], default: [] },
}, { timestamps: true, optimisticConcurrency: true });

schema.index({ project: 1, owner: 1, createdAt: 1, _id: 1 });
module.exports = mongoose.model("ProjectTask", schema);
