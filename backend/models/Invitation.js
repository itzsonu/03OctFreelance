const mongoose = require("mongoose");

const invitationSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  freelancer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  note: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ["PENDING", "RESPONDED", "DECLINED"], default: "PENDING" },
}, { timestamps: true });

invitationSchema.index({ project: 1, freelancer: 1 }, { unique: true });
invitationSchema.index({ freelancer: 1, createdAt: -1 });

module.exports = mongoose.model("Invitation", invitationSchema);
