const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema({
  question: { type: String, trim: true, maxlength: 300 },
  answer: { type: String, trim: true, maxlength: 1000 },
}, { _id: false });

const offerMilestoneSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: "", trim: true, maxlength: 1000 },
  payment: { type: Number, required: true, min: 0 },
  dueDate: { type: String, default: "" },
  dependsOn: { type: [Number], default: undefined },
}, { _id: false });

const offerTermsSchema = new mongoose.Schema({
  scope: { type: String, required: true, trim: true, minlength: 10, maxlength: 5000 },
  amount: { type: Number, required: true, min: 0.01 },
  deliveryDate: { type: String, required: true },
  milestones: { type: [offerMilestoneSchema], required: true },
}, { _id: false, strict: "throw" });

const offerAcceptanceSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  acceptedAt: { type: Date, required: true },
}, { _id: false });

const offerSchema = new mongoose.Schema({
  listingRevision: { type: Number, default: 0 },
  version: { type: Number, required: true },
  terms: { type: offerTermsSchema, required: true, immutable: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, required: true },
  status: { type: String, enum: ["OPEN", "AGREED", "DECLINED", "STALE"], default: "OPEN" },
  acceptances: { type: [offerAcceptanceSchema], default: [] },
}, { strict: "throw" });

const offerEventSchema = new mongoose.Schema({
  offer: { type: mongoose.Schema.Types.ObjectId, required: true },
  version: { type: Number, required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, enum: ["proposed", "countered", "accepted", "declined", "staled"], required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const applicationSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },

    freelancer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    proposal: {
      type: String,
      default: "",
      trim: true,
    },

    proposedPrice: { type: Number, default: null, min: 0.01 },
    deliveryEstimateDays: { type: Number, default: null, min: 1, max: 3650 },
    portfolioLinks: { type: [String], default: [] },
    answers: { type: [answerSchema], default: [] },
    proposalRevision: { type: Number, default: 1 },
    shortlisted: { type: Boolean, default: false },
    shortlistedAt: { type: Date, default: null },
    shortlistedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    offers: { type: [offerSchema], default: [] },
    currentOfferId: { type: mongoose.Schema.Types.ObjectId, default: null },
    currentOfferState: { type: String, enum: ["NONE", "OPEN", "AGREED", "DECLINED", "STALE"], default: "NONE" },
    offerEvents: { type: [offerEventSchema], default: [] },

    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "REJECTED", "WITHDRAWN"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

applicationSchema.index({ project: 1 });
applicationSchema.index({ freelancer: 1 });
applicationSchema.index({ project: 1, freelancer: 1 }, { unique: true });

module.exports = mongoose.model("Application", applicationSchema);
