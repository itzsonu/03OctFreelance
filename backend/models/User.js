const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    ...require("./moderationFields")(),
    suspended: { type: Boolean, default: false },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: function () { return this.authProvider !== "google"; },
    },
    authProvider: { type: String, enum: ["password", "google"], default: "password" },
    googleSubject: { type: String, select: false },
    emailVerifiedAt: { type: Date, default: null },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationEmail: { type: String, select: false },
    emailVerificationExpiresAt: { type: Date, select: false },
    emailVerificationRequestedAt: { type: Date, select: false },
    emailPreferences: {
      proposals: { type: Boolean, default: false },
      offers: { type: Boolean, default: false },
      submissions: { type: Boolean, default: false },
      revisions: { type: Boolean, default: false },
    },
    pendingEmail: { type: String, select: false },
    emailChangeTokenHash: { type: String, select: false },
    emailChangeExpiresAt: { type: Date, select: false },
    emailChangeRequestedAt: { type: Date, select: false },
    tokenVersion: { type: Number, default: 0 },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },
    passwordResetRequestedAt: { type: Date, select: false },
    role: {
      type: String,
      enum: ["client", "freelancer", "admin"],
      required: true,
    },
    savedProjects: [{ type: mongoose.Schema.Types.ObjectId, ref: "Project" }],
    profile: {
      headline: { type: String, default: "" },
      bio: { type: String, default: "" },
      skills: { type: [String], default: [] },
      preferredCategories: { type: [String], enum: require("../projectCategories").JOB_CATEGORIES, default: [] },
      experienceYears: { type: Number, default: 0 },
      portfolioUrl: { type: String, default: "" },
      portfolioItems: [{
        title: { type: String, default: "" },
        description: { type: String, default: "" },
        url: { type: String, default: "" },
      }],
      availability: { type: String, enum: ["available", "limited", "unavailable"], default: "available" },
      hourlyRate: { type: Number, min: 0, default: null },
      discoverable: { type: Boolean, default: false },
    },
    company: {
      name: { type: String, default: "" },
      overview: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

userSchema.index({ googleSubject: 1 }, { unique: true, sparse: true });
userSchema.index({ role: 1, suspended: 1, createdAt: -1, _id: -1 });
module.exports = mongoose.model("User", userSchema);
