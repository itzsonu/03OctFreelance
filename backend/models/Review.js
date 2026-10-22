const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reviewee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  reviewerRole: { type: String, enum: ["client", "freelancer"], required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  text: { type: String, required: true, trim: true, maxlength: 1000 },
}, { timestamps: true });

reviewSchema.index({ project: 1, reviewer: 1 }, { unique: true });
reviewSchema.index({ reviewee: 1, createdAt: -1 });

module.exports = mongoose.model("Review", reviewSchema);
