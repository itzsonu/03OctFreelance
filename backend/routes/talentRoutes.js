const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Project = require("../models/Project");
const Review = require("../models/Review");
const { protect, allowRoles } = require("../middleware/authMiddleware");
const { trustFromProjects } = require("../scoring");

const router = express.Router();
router.use(protect, allowRoles("client"));

router.get("/", async (req, res) => {
  try {
    const allowedParams = new Set(["q", "skill", "availability", "minExperience", "maxExperience", "page", "pageSize", "sort"]);
    if (Object.keys(req.query).some(key => !allowedParams.has(key))) throw new Error("Invalid query parameter");
    const stringParam = (key, maxLength) => {
      const value = req.query[key];
      if (value === undefined) return "";
      if (typeof value !== "string" || value.trim().length > maxLength) throw new Error(`Invalid ${key} filter`);
      return value.trim();
    };
    const query = stringParam("q", 80);
    const skill = stringParam("skill", 40);
    const availability = stringParam("availability", 20);
    const numberParam = key => {
      const value = req.query[key];
      if (value === undefined || value === "") return null;
      if (typeof value !== "string" || !/^\d+$/.test(value) || Number(value) > 60) throw new Error(`Invalid ${key} filter`);
      return Number(value);
    };
    const minExperience = numberParam("minExperience");
    const maxExperience = numberParam("maxExperience");
    const pageValue = req.query.page === undefined ? "1" : req.query.page;
    const pageSizeValue = req.query.pageSize === undefined ? "12" : req.query.pageSize;
    const sort = req.query.sort === undefined ? "newest" : req.query.sort;
    if (typeof pageValue !== "string" || !/^\d+$/.test(pageValue) || Number(pageValue) < 1 || Number(pageValue) > 10000) throw new Error("Invalid page");
    if (typeof pageSizeValue !== "string" || !/^\d+$/.test(pageSizeValue) || Number(pageSizeValue) < 1 || Number(pageSizeValue) > 50) throw new Error("Invalid page size");
    if (! ["newest", "name", "experience-high", "experience-low", "rate-high", "rate-low"].includes(sort)) throw new Error("Invalid sort order");
    if (availability && !["available", "limited", "unavailable"].includes(availability)) throw new Error("Invalid availability filter");
    if (minExperience !== null && maxExperience !== null && minExperience > maxExperience) throw new Error("Minimum experience cannot exceed maximum experience");
    const page = Number(pageValue);
    const pageSize = Number(pageSizeValue);
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = { role: "freelancer", "profile.discoverable": true };
    if (query) {
      const expression = new RegExp(escape(query), "i");
      filter.$or = [{ name: expression }, { "profile.headline": expression }, { "profile.bio": expression }, { "profile.skills": expression }];
    }
    if (skill) filter["profile.skills"] = new RegExp(`^${escape(skill)}$`, "i");
    if (availability) filter["profile.availability"] = availability === "available" ? { $in: ["available", null] } : availability;
    if (minExperience !== null || maxExperience !== null) filter["profile.experienceYears"] = { ...(minExperience !== null ? { $gte: minExperience } : {}), ...(maxExperience !== null ? { $lte: maxExperience } : {}) };
    const sortOptions = { newest: { createdAt: -1 }, name: { name: 1 }, "experience-high": { "profile.experienceYears": -1 }, "experience-low": { "profile.experienceYears": 1 }, "rate-high": { "profile.hourlyRate": -1 }, "rate-low": { "profile.hourlyRate": 1 } };
    const [users, total] = await Promise.all([
      User.find(filter).select("name profile.headline profile.bio profile.skills profile.experienceYears profile.portfolioUrl profile.portfolioItems profile.availability profile.hourlyRate")
        .sort(sortOptions[sort]).skip((page - 1) * pageSize).limit(pageSize).lean(),
      User.countDocuments(filter),
    ]);
    const work = users.length ? await Project.find({ freelancer: { $in: users.map(user => user._id) } })
      .select("freelancer client status milestones.status milestones.revisionCount").lean() : [];
    const byFreelancer = new Map();
    for (const project of work) {
      const id = project.freelancer.toString();
      byFreelancer.set(id, [...(byFreelancer.get(id) || []), project]);
    }
    const clientReviews = users.length ? await Review.find({ reviewee: { $in: users.map(user => user._id) }, reviewerRole: "client" }).select("project reviewee rating").lean() : [];
    const reciprocalProjects = clientReviews.length ? new Set((await Review.find({ project: { $in: clientReviews.map(review => review.project) }, reviewerRole: "freelancer" }).select("project").lean()).map(review => review.project.toString())) : new Set();
    const ratings = new Map();
    for (const review of clientReviews) {
      if (!reciprocalProjects.has(review.project.toString())) continue;
      const id = review.reviewee.toString();
      const existing = ratings.get(id) || { sum: 0, count: 0 };
      ratings.set(id, { sum: existing.sum + review.rating, count: existing.count + 1 });
    }
    res.json({ total, page, pageSize, pages: Math.ceil(total / pageSize), talent: users.map(user => ({
      id: user._id,
      name: user.name,
      headline: user.profile?.headline || "",
      bio: user.profile?.bio || "",
      skills: user.profile?.skills || [],
      experienceYears: user.profile?.experienceYears || 0,
      portfolioUrl: user.profile?.portfolioUrl || "",
      portfolioItems: user.profile?.portfolioItems || [],
      availability: user.profile?.availability || "available",
      hourlyRate: user.profile?.hourlyRate ?? null,
      trust: trustFromProjects(byFreelancer.get(user._id.toString()) || []),
      reviews: ratings.has(user._id.toString()) ? { average: Math.round(ratings.get(user._id.toString()).sum / ratings.get(user._id.toString()).count * 10) / 10, count: ratings.get(user._id.toString()).count } : { average: null, count: 0 },
    })) });
  } catch (error) {
    if (error.message.startsWith("Invalid ") || error.message.includes("cannot exceed")) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: "Unable to load talent" });
  }
});

router.get("/:freelancerId", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.freelancerId)) return res.status(400).json({ message: "Invalid freelancer" });
  const freelancer = await User.findOne({ _id: req.params.freelancerId, role: "freelancer", "profile.discoverable": true })
    .select("name profile.headline profile.bio profile.skills profile.experienceYears profile.portfolioUrl profile.portfolioItems profile.availability profile.hourlyRate").lean();
  if (!freelancer) return res.status(404).json({ message: "Profile is not available" });
  const [projects, clientReviews] = await Promise.all([
    Project.find({ freelancer: freelancer._id }).select("freelancer client status milestones.status milestones.revisionCount").lean(),
    Review.find({ reviewee: freelancer._id, reviewerRole: "client" }).select("project rating text createdAt").sort({ createdAt: -1 }).lean(),
  ]);
  const reciprocal = clientReviews.length ? await Review.find({ project: { $in: clientReviews.map(review => review.project) }, reviewerRole: "freelancer" }).select("project").lean() : [];
  const reciprocalIds = new Set(reciprocal.map(review => review.project.toString()));
  const visibleReviews = clientReviews.filter(review => reciprocalIds.has(review.project.toString()));
  res.json({
    id: freelancer._id,
    name: freelancer.name,
    headline: freelancer.profile?.headline || "",
    bio: freelancer.profile?.bio || "",
    skills: freelancer.profile?.skills || [],
    experienceYears: freelancer.profile?.experienceYears || 0,
    portfolioUrl: freelancer.profile?.portfolioUrl || "",
    portfolioItems: freelancer.profile?.portfolioItems || [],
    availability: freelancer.profile?.availability || "available",
    hourlyRate: freelancer.profile?.hourlyRate ?? null,
    trust: trustFromProjects(projects),
    reviews: { average: visibleReviews.length ? Math.round(visibleReviews.reduce((sum, review) => sum + review.rating, 0) / visibleReviews.length * 10) / 10 : null, count: visibleReviews.length, items: visibleReviews.slice(0, 10).map(review => ({ rating: review.rating, text: review.text, createdAt: review.createdAt })) },
  });
});

module.exports = router;
