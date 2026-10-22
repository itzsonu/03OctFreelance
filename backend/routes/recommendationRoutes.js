const express = require("express");
const Project = require("../models/Project");
const { protect, allowRoles } = require("../middleware/authMiddleware");
const { publicStages } = require("../moderation");
const { pagination } = require("../pagination");
const { todayISO } = require("../projectDates");
const { profileSetup, recommendationStages, recommendationReason } = require("../coldStart");
const router = express.Router();

router.get("/recommended", protect, allowRoles("freelancer"), async (req, res) => {
  try {
    if (Object.keys(req.query).some(key => !["page", "pageSize"].includes(key))) return res.status(400).json({ message: "Invalid recommendation filter" });
    const paging = pagination(req.query, 3);
    const profile = req.user.profile || {};
    const setup = profileSetup(profile);
    const hasSignals = Boolean(profile.skills?.length || profile.preferredCategories?.length);
    const base = { page: paging.page, pageSize: paging.pageSize, setup, availability: profile.availability || "available", mode: hasSignals ? "profile" : "setup" };
    if (!hasSignals) return res.json({ ...base, projects: [], total: 0, pages: 0 });
    const [result] = await Project.aggregate([
      ...publicStages({ freelancer: null, deadline: { $gte: todayISO() } }),
      ...recommendationStages(profile),
      { $lookup: { from: "applications", let: { project: "$_id" }, pipeline: [
        { $match: { $expr: { $and: [{ $eq: ["$project", "$$project"] }, { $eq: ["$freelancer", req.user._id] }] } } },
        { $limit: 1 }, { $project: { _id: 1 } },
      ], as: "_ownApplication" } },
      { $match: { "_ownApplication.0": { $exists: false } } },
      { $facet: {
        projects: [
          { $sort: { _hasSkillMatch: -1, _coverage: -1, _matchedCount: -1, _categoryMatch: -1, createdAt: -1, _id: -1 } },
          { $skip: paging.skip }, { $limit: paging.pageSize },
          { $project: { title: 1, description: 1, category: 1, customCategory: 1, requiredSkills: 1, budget: 1, deadline: 1 } },
        ], total: [{ $count: "count" }],
      } },
    ]);
    const total = result?.total[0]?.count || 0;
    res.json({ ...base, total, pages: Math.ceil(total / paging.pageSize), projects: (result?.projects || []).map(project => ({ ...project, category: project.category || "Other", reason: recommendationReason(project, profile) })) });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status === 400 ? error.message : "Unable to load suggested projects" });
  }
});
module.exports = router;
