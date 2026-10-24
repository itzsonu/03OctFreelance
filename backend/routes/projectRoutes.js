const { saveAttachments, discardAttachments } = require("../attachmentStorage");
const express = require("express");
const mongoose = require("mongoose");
const Project = require("../models/Project");
const Application = require("../models/Application");
const User = require("../models/User");
const { protect, allowRoles } = require("../middleware/authMiddleware");
const { unlockReadyMilestones } = require("../workflow");
const { projectInsights } = require("../insights");
const { projectOutlook } = require("../outlook");
const { suggestMilestones } = require("../planner");
const { suggestSkills } = require("../skillSuggestions");
const { generateAiMilestones, validatePlanInput } = require("../aiPlanner");
const { aiStatus } = require("../aiProvider");
const { publishProject, publishMarketplace } = require("../liveUpdates");
const { notifyUser } = require("../notifications");
const { parseFiles } = require("../fileStorage");
const { JOB_CATEGORIES } = require("../projectCategories");
const { normalizeProjectDraft } = require("../projectDraft");
const { pagination, listResponse } = require("../pagination");
const { publicStages, ownerLookup, hiringAvailable } = require("../moderation");
const { readSession } = require("../sessions");

const router = express.Router();
router.use(require("./recommendationRoutes"));
router.use(require("./projectLifecycleRoutes"));
router.use(require("./projectChangeRoutes"));
const withAnalytics = project => ({ ...(project.toObject ? project.toObject() : project), insights: projectInsights(project), outlook: projectOutlook(project) });
const aiPlanCooldown = new Map();
const AI_PLAN_COOLDOWN_MS = 60 * 1000;


const attachmentView = attachment => ({
  id: attachment._id,
  filename: attachment.filename,
  mimeType: attachment.mimeType,
  size: attachment.size,
});

// Only fields from an open job post are exposed to visitors. Project activity,
// submissions, client contact details and freelancer details stay private.
router.get("/public", async (req, res) => {
  try {
    const allowedParams = new Set(["q", "skill", "category", "minBudget", "maxBudget", "deadlineFrom", "deadlineTo", "page", "pageSize", "sort"]);
    if (Object.keys(req.query).some(key => !allowedParams.has(key))) throw new Error("Invalid query parameter");
    const stringParam = (key, maxLength) => {
      const value = req.query[key];
      if (value === undefined) return "";
      if (typeof value !== "string" || value.trim().length > maxLength) throw new Error(`Invalid ${key} filter`);
      return value.trim();
    };
    const numberParam = key => {
      const value = req.query[key];
      if (value === undefined || value === "") return null;
      if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value))) throw new Error(`Invalid ${key} filter`);
      return Number(value);
    };
    const dateParam = key => {
      const value = stringParam(key, 10);
      if (!value) return "";
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid ${key} filter`);
      return value;
    };
    const query = stringParam("q", 80);
    const skill = stringParam("skill", 40);
    const category = stringParam("category", 40);
    const minBudget = numberParam("minBudget");
    const maxBudget = numberParam("maxBudget");
    const deadlineFrom = dateParam("deadlineFrom");
    const deadlineTo = dateParam("deadlineTo");
    const pageValue = req.query.page === undefined ? "1" : req.query.page;
    const pageSizeValue = req.query.pageSize === undefined ? "12" : req.query.pageSize;
    const sort = req.query.sort === undefined ? "newest" : req.query.sort;
    if (typeof pageValue !== "string" || !/^\d+$/.test(pageValue) || Number(pageValue) < 1 || Number(pageValue) > 10000) throw new Error("Invalid page");
    if (typeof pageSizeValue !== "string" || !/^\d+$/.test(pageSizeValue) || Number(pageSizeValue) < 1 || Number(pageSizeValue) > 50) throw new Error("Invalid page size");
    if (! ["newest", "oldest", "budget-high", "budget-low", "deadline-soon"].includes(sort)) throw new Error("Invalid sort order");
    if (category && !JOB_CATEGORIES.includes(category)) throw new Error("Invalid category filter");
    if (minBudget !== null && maxBudget !== null && minBudget > maxBudget) throw new Error("Minimum budget cannot exceed maximum budget");
    if (deadlineFrom && deadlineTo && deadlineFrom > deadlineTo) throw new Error("Deadline start cannot be after deadline end");
    const page = Number(pageValue);
    const pageSize = Number(pageSizeValue);
    const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = { status: "Open" };
    if (query) {
      const expression = new RegExp(escape(query), "i");
      filter.$or = [{ title: expression }, { description: expression }, { requiredSkills: expression }, { customCategory: expression }];
    }
    if (skill) filter.requiredSkills = new RegExp(`^${escape(skill)}$`, "i");
    if (category === "Other") {
      const legacyCategory = { $or: [{ category: "Other" }, { category: { $exists: false } }, { category: null }] };
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, legacyCategory];
        delete filter.$or;
      } else {
        filter.$or = legacyCategory.$or;
      }
    } else if (category) filter.category = category;
    if (minBudget !== null || maxBudget !== null) filter.budget = { ...(minBudget !== null ? { $gte: minBudget } : {}), ...(maxBudget !== null ? { $lte: maxBudget } : {}) };
    if (deadlineFrom || deadlineTo) filter.deadline = { ...(deadlineFrom ? { $gte: deadlineFrom } : {}), ...(deadlineTo ? { $lte: deadlineTo } : {}) };
    const sortOptions = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, "budget-high": { budget: -1 }, "budget-low": { budget: 1 }, "deadline-soon": { deadline: 1 } };
    const [result] = await Project.aggregate([...publicStages(filter), { $facet: { projects: [{ $sort: { ...sortOptions[sort], _id: sort === "oldest" ? 1 : -1 } }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }, { $project: { title: 1, category: 1, customCategory: 1, description: 1, requiredSkills: 1, budget: 1, deadline: 1, createdAt: 1 } }], total: [{ $count: "count" }] } }]);
    const projects = result.projects; const total = result.total[0]?.count || 0;
    const auth = req.headers.cookie ? await readSession(req, false) : null;
    if (auth?.user.role === "freelancer" && projects.length) {
      const own = await Application.find({ freelancer: auth.user._id, project: { $in: projects.map(item => item._id) } }).select("project status").lean();
      const statuses = new Map(own.map(item => [String(item.project), item.status]));
      projects.forEach(item => { item.applicationStatus = statuses.get(String(item._id)) || null; });
    }
    res.json({ projects: projects.map(project => ({ ...project, category: project.category || "Other" })), total, page, pageSize, pages: Math.ceil(total / pageSize) });
  } catch (error) {
    if (error.message.startsWith("Invalid ") || error.message.includes("cannot exceed") || error.message.includes("cannot be after")) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: "Unable to load open projects" });
  }
});

router.get("/public/:projectId", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) return res.status(400).json({ message: "Invalid project ID" });
  const project = await Project.findOne({ _id: req.params.projectId, status: "Open", moderationHidden: { $ne: true } })
    .select("title category customCategory description requiredSkills budget deadline milestones.title milestones.description milestones.payment milestones.dueDate createdAt client")
    .lean();
  if (!project) return res.status(404).json({ message: "Project is no longer open" });
  const client = project.client ? await User.findById(project.client).select("name company.name company.overview suspended").lean() : null;
  if (!client || client.suspended) return res.status(404).json({ message: "Project is no longer open" });
  res.json({
    id: project._id,
    title: project.title,
    category: project.category || "Other",
    customCategory: project.category === "Other" ? project.customCategory || "" : "",
    description: project.description,
    requiredSkills: project.requiredSkills,
    budget: project.budget,
    deadline: project.deadline,
    createdAt: project.createdAt,
    company: { name: client?.company?.name || "", overview: client?.company?.overview || "" },
    milestones: (project.milestones || []).map(item => ({ id: item._id, title: item.title, description: item.description, payment: item.payment, dueDate: item.dueDate || "" })),
  });
});

router.get("/saved", protect, allowRoles("freelancer"), async (req, res) => {
  const user = await User.findById(req.user._id).select("savedProjects").lean();
  res.json((user?.savedProjects || []).map(id => id.toString()));
});

router.put("/saved/:projectId", protect, allowRoles("freelancer"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) return res.status(400).json({ message: "Invalid project ID" });
  const project = await Project.findById(req.params.projectId).select("status client moderationHidden").lean();
  if (!project || project.status !== "Open" || !await hiringAvailable(project)) return res.status(409).json({ message: "This project is no longer open" });
  await User.updateOne({ _id: req.user._id }, { $addToSet: { savedProjects: project._id } });
  res.json({ saved: true });
});

router.delete("/saved/:projectId", protect, allowRoles("freelancer"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) return res.status(400).json({ message: "Invalid project ID" });
  await User.updateOne({ _id: req.user._id }, { $pull: { savedProjects: req.params.projectId } });
  res.json({ saved: false });
});

router.post("/suggest-skills", protect, allowRoles("client"), (req, res) => {
  try { res.json(suggestSkills(req.body)); }
  catch (error) { res.status(400).json({ message: error.message }); }
});

router.get("/ai-planning-status", protect, allowRoles("client"), (req, res) => {
  res.json(aiStatus());
});

router.post("/ai-suggest-milestones", protect, allowRoles("client"), async (req, res) => {
  try {
    validatePlanInput(req.body || {});
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  if (!aiStatus().available) return res.status(503).json({ message: "AI planning is not configured. Use the guided draft instead." });
  const userId = String(req.user._id);
  const now = Date.now();
  if ((aiPlanCooldown.get(userId) || 0) > now) return res.status(429).json({ message: "Please wait a minute before requesting another AI draft." });
  aiPlanCooldown.set(userId, now + AI_PLAN_COOLDOWN_MS);
  if (aiPlanCooldown.size > 10000) aiPlanCooldown.delete(aiPlanCooldown.keys().next().value);
  try {
    res.json(await generateAiMilestones(req.body));
  } catch (error) {
    console.error("AI planning failed", error.aiProviderFailure ? "provider_response" : error.message?.includes("invalid milestone plan") ? "invalid_plan" : error.message?.includes("could not complete") ? "incomplete_plan" : error.message?.includes("usable plan") ? "empty_plan" : "network_or_response");
    res.status(error.aiProviderFailure ? error.status : 502).json({ message: error.aiProviderFailure ? error.message : "AI planning is unavailable right now. Try again or use the guided draft." });
  }
});

router.post("/suggest-milestones", protect, allowRoles("client"), (req, res) => {
  try {
    res.json(suggestMilestones(req.body || {}));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/create", protect, allowRoles("client"), async (req, res) => {
  try {
    let draft;
    try { draft = normalizeProjectDraft(req.body); }
    catch (error) { return res.status(400).json({ message: error.message }); }
    const project = await Project.create({ ...draft, activity: [{ type: "project_created", actor: req.user._id, actorName: req.user.name || "Client", note: "Project created" }], client: req.user._id });

    publishProject(project);
    publishMarketplace();

    res.status(201).json({
      message: "Project created successfully",
      project,
    });
  } catch (error) {
    res.status(error.name === "VersionError" ? 409 : 500).json({ message: error.name === "VersionError" ? "Project changed. Reload before trying again." : "Server error" });
  }
});

router.get("/all", protect, async (req, res) => {
  try {
    const paging = pagination(req.query);
    if (req.query.view && !["assigned", "saved"].includes(req.query.view)) return res.status(400).json({ message: "Invalid project view" });
    const owner = req.user._id; const saved = req.user.savedProjects || [];
    const stages = req.user.role === "client" ? [{ $match: { client: owner } }] : [ownerLookup(), { $match: { $or: [{ freelancer: owner }, { status: "Open", moderationHidden: { $ne: true }, "availableOwner.0": { $exists: true } }] } }];
    const view = req.query.view === "assigned" ? [{ $match: { freelancer: owner } }] : req.query.view === "saved" ? [{ $match: { _id: { $in: saved }, status: "Open", moderationHidden: { $ne: true }, "availableOwner.0": { $exists: true } } }] : [];
    const [result] = await Project.aggregate([...stages, { $facet: {
      items: [...view, { $sort: { createdAt: -1, _id: -1 } }, { $skip: paging.skip }, { $limit: paging.pageSize }, { $project: { title: 1, description: 1, category: 1, customCategory: 1, requiredSkills: 1, status: 1, client: 1, freelancer: 1, budget: 1, deadline: 1, createdAt: 1, updatedAt: 1, moderationHidden: 1, moderationReason: 1, milestones: { $map: { input: "$milestones", as: "step", in: { _id: "$$step._id", title: "$$step.title", status: "$$step.status", dueDate: "$$step.dueDate", approvedAt: "$$step.approvedAt" } } } } }],
      total: [...view, { $count: "count" }],
      summary: [{ $group: { _id: null, open: { $sum: { $cond: [{ $eq: ["$status", "Open"] }, 1, 0] } }, assigned: { $sum: { $cond: [{ $eq: ["$freelancer", owner] }, 1, 0] } }, active: { $sum: { $cond: [{ $and: [{ $eq: ["$freelancer", owner] }, { $eq: ["$status", "In Progress"] }] }, 1, 0] } }, saved: { $sum: { $cond: [{ $and: [{ $in: ["$_id", saved] }, { $eq: ["$status", "Open"] }] }, 1, 0] } } } }],
    } }]);
    const projects = await Project.populate(result.items, [{ path: "client", select: "name" }, { path: "freelancer", select: "name" }]);
    listResponse(res, projects.map(withAnalytics), result.total[0]?.count || 0, paging, { summary: result.summary[0] || { open: 0, assigned: 0, active: 0, saved: 0 } });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load projects" });
  }
});

router.get("/mine", protect, allowRoles("client"), async (req, res) => {
  try {
    const paging = pagination(req.query);
    if (req.query.view && req.query.view !== "invitable") return res.status(400).json({ message: "Invalid project view" });
    const filter = { client: req.user._id, ...(req.query.view === "invitable" ? { status: "Open", freelancer: null, moderationHidden: { $ne: true } } : {}) };
    const projects = await Project.find(filter)
      .populate("freelancer", "name")
      .sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.pageSize);
    const [summary] = await Project.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ["$status", "In Progress"] }, 1, 0] } }, waiting: { $sum: { $cond: [{ $eq: ["$status", "In Progress"] }, { $size: { $filter: { input: { $ifNull: ["$milestones", []] }, as: "step", cond: { $eq: ["$$step.status", "submitted"] } } } }, 0] } } } }]);
    listResponse(res, projects.map(withAnalytics), summary?.total || 0, paging, { summary: summary || { total: 0, active: 0, waiting: 0 } });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load projects" });
  }
});

router.get("/:projectId", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) {
      return res.status(404).json({ message: "Project not found" });
    }

    const project = await Project.findById(req.params.projectId)
      .populate("client", "name email")
      .populate("freelancer", "name email")
      .populate("milestones.submissions.author", "name")
      .populate("milestones.submissions.files", "filename mimeType size createdAt")
      .populate("milestones.revisionRequests.author", "name");

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const currentUserId = req.user._id.toString();
    const projectClientId = project.client
      ? project.client._id
        ? project.client._id.toString()
        : project.client.toString()
      : null;
    const projectFreelancerId = project.freelancer
      ? project.freelancer._id
        ? project.freelancer._id.toString()
        : project.freelancer.toString()
      : null;

    const isClientProject = projectClientId && projectClientId === currentUserId;
    const isAssignedFreelancer =
      projectFreelancerId && projectFreelancerId === currentUserId;

    if (!isClientProject && !isAssignedFreelancer) {
      return res.status(403).json({ message: "Access denied" });
    }

    const conversation = project.freelancer
      ? await Application.findOne({ project: project._id, freelancer: project.freelancer._id, status: "ACCEPTED" }).select("_id").lean()
      : null;
    res.json({ ...withAnalytics(project), conversationApplicationId: conversation?._id || null });
  } catch (error) {
    res.status(error.name === "VersionError" ? 409 : 500).json({ message: error.name === "VersionError" ? "Project changed. Reload before trying again." : "Server error" });
  }
});

router.post(
  "/:projectId/milestone/:milestoneId/submit",
  protect,
  allowRoles("freelancer"),
  parseFiles,
  async (req, res) => {
    try {
      const submittedWork = typeof req.body.submittedWork === "string"
        ? req.body.submittedWork.trim()
        : "";
      if ((!submittedWork && !req.files?.length) || submittedWork.length > 5000) {
        return res.status(400).json({ message: "Describe the submitted work or attach a file (up to 5000 characters)" });
      }

      if (!mongoose.Types.ObjectId.isValid(req.params.milestoneId)) {
        return res.status(404).json({ message: "Milestone not found" });
      }

      if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) {
        return res.status(404).json({ message: "Project not found" });
      }

      const project = await Project.findById(req.params.projectId);

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      if (!project.freelancer || project.freelancer.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (project.status !== "In Progress" || project.pendingCancellation || project.pendingAmendment) return res.status(409).json({ message: "Milestone changes require an active project with no pending cancellation or change request" });
      const milestone = project.milestones.id(req.params.milestoneId);

      if (!milestone) {
        return res.status(404).json({ message: "Milestone not found" });
      }

      if (!["active", "revision_requested"].includes(milestone.status)) {
        return res.status(400).json({
          message: "Only active or revision-requested milestones can be submitted",
        });
      }

      const isRevision = milestone.status === "revision_requested";
      if (isRevision && milestone.submissions.length === 0 && milestone.submittedWork) {
        milestone.submissions.push({ work: milestone.submittedWork, submittedAt: milestone.submittedAt, version: 1 });
      }
      const attachments = await saveAttachments(project, req.user, req.files);
      milestone.status = "submitted";
      milestone.submittedWork = submittedWork;
      milestone.submittedAt = new Date();
      const submission = milestone.submissions.create({
        work: submittedWork,
        submittedAt: milestone.submittedAt,
        author: req.user._id,
        files: attachments.map(item => item._id),
        version: milestone.submissions.length + 1,
      });
      milestone.submissions.push(submission);
      milestone.currentSubmission = submission._id;
      project.activity.push({ type: isRevision ? "work_resubmitted" : "work_submitted", actor: req.user._id, actorName: req.user.name || "Freelancer", milestoneId: milestone._id, milestoneTitle: milestone.title, note: isRevision ? "Revised work submitted" : "Work submitted" });

      try { await project.save(); }
      catch (error) {
        await discardAttachments(attachments);
        throw error;
      }
      publishProject(project);
      await notifyUser(project.client, "milestone", "Work submitted for review", `${req.user.name || "Your freelancer"} submitted ${milestone.title}.`, `/milestones/${project._id}`, "submissions");

      res.json({
        message: "Milestone submitted successfully",
        project,
      });
    } catch (error) {
      if (error.name === "VersionError") return res.status(409).json({ message: "Project changed. Reload before trying again." });
      res.status(error.status || (error.code === "INVALID_FILE" ? 400 : 500)).json({ message: error.status || error.code === "INVALID_FILE" ? error.message : "Server error" });
    }
  }
);

router.post(
  "/:projectId/milestone/:milestoneId/approve",
  protect,
  allowRoles("client"),
  async (req, res) => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.milestoneId)) {
        return res.status(404).json({ message: "Milestone not found" });
      }

      if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) {
        return res.status(404).json({ message: "Project not found" });
      }

      const project = await Project.findById(req.params.projectId);

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      if (project.client.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Access denied" });
      }

      if (project.status !== "In Progress" || project.pendingCancellation || project.pendingAmendment) return res.status(409).json({ message: "Milestone changes require an active project with no pending cancellation or change request" });
      const milestoneIndex = project.milestones.findIndex(
        (m) => m._id.toString() === req.params.milestoneId
      );

      if (milestoneIndex === -1) {
        return res.status(404).json({ message: "Milestone not found" });
      }

      const milestone = project.milestones[milestoneIndex];

      if (milestone.status !== "submitted") {
        return res.status(400).json({
          message: "Only submitted milestone can be approved",
        });
      }

      if (milestone.submissions.length === 0 && milestone.submittedWork) {
        milestone.submissions.push({ work: milestone.submittedWork, submittedAt: milestone.submittedAt, version: 1 });
      }
      const latestSubmission = milestone.submissions[milestone.submissions.length - 1];
      if (!latestSubmission || (milestone.currentSubmission && milestone.currentSubmission.toString() !== latestSubmission._id.toString())) {
        return res.status(409).json({ message: "The latest submitted version must be reviewed" });
      }
      if (req.body?.submissionId && req.body.submissionId !== latestSubmission._id.toString()) {
        return res.status(409).json({ message: "Only the latest submitted version can be approved" });
      }
      milestone.currentSubmission = latestSubmission._id;

      milestone.status = "completed";
      milestone.approvedAt = new Date();

      project.activity.push({ type: "milestone_approved", actor: req.user._id, actorName: req.user.name || "Client", milestoneId: milestone._id, milestoneTitle: milestone.title, note: "Milestone approved" });
      const unlocked = unlockReadyMilestones(project);
      unlocked.forEach(item => project.activity.push({ type: "milestone_unlocked", actor: req.user._id, actorName: req.user.name || "Client", milestoneId: item._id, milestoneTitle: item.title, note: "All prerequisites approved" }));
      if (project.milestones.every(item => item.status === "completed")) {
        project.status = "Completed";
        project.activity.push({ type: "project_completed", actor: req.user._id, actorName: req.user.name || "Client", note: "All milestones approved" });
      }

      await project.save();
      publishProject(project);
      await notifyUser(project.freelancer, "milestone", "Milestone approved", `${milestone.title} was approved${project.status === "Completed" ? "; the project is complete" : ""}.`, `/milestones/${project._id}`);

      res.json({
        message: "Milestone approved successfully",
        project,
      });
    } catch (error) {
      res.status(error.name === "VersionError" ? 409 : 500).json({ message: error.name === "VersionError" ? "Project changed. Reload before trying again." : "Server error" });
    }
  }
);

router.post(
  "/:projectId/milestone/:milestoneId/request-revision",
  protect,
  allowRoles("client"),
  async (req, res) => {
    try {
      const feedback = typeof req.body.feedback === "string" ? req.body.feedback.trim() : "";
      if (feedback.length < 10 || feedback.length > 1000) {
        return res.status(400).json({ message: "Describe the required changes in 10–1000 characters" });
      }
      if (!mongoose.Types.ObjectId.isValid(req.params.projectId) || !mongoose.Types.ObjectId.isValid(req.params.milestoneId)) {
        return res.status(404).json({ message: "Project or milestone not found" });
      }
      const project = await Project.findById(req.params.projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });
      if (project.client.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Access denied" });
      if (project.status !== "In Progress" || project.pendingCancellation || project.pendingAmendment) return res.status(409).json({ message: "Milestone changes require an active project with no pending cancellation or change request" });
      const milestone = project.milestones.id(req.params.milestoneId);
      if (!milestone) return res.status(404).json({ message: "Milestone not found" });
      if (milestone.status !== "submitted") return res.status(400).json({ message: "Only submitted work can be sent back for revision" });
      if (milestone.submissions.length === 0 && milestone.submittedWork) {
        milestone.submissions.push({ work: milestone.submittedWork, submittedAt: milestone.submittedAt, version: 1 });
      }
      const latestSubmission = milestone.submissions[milestone.submissions.length - 1];
      if (!latestSubmission || (milestone.currentSubmission && milestone.currentSubmission.toString() !== latestSubmission._id.toString())) return res.status(409).json({ message: "The latest submitted version must be reviewed" });
      if (req.body?.submissionId && req.body.submissionId !== latestSubmission._id.toString()) return res.status(409).json({ message: "The submission changed. Review the latest version before requesting changes." });
      milestone.currentSubmission = latestSubmission._id;
      milestone.status = "revision_requested";
      milestone.revisionFeedback = feedback;
      milestone.revisionRequestedAt = new Date();
      milestone.revisionCount += 1;
      milestone.revisionRequests.push({ submission: latestSubmission._id, feedback, author: req.user._id });
      project.activity.push({ type: "revision_requested", actor: req.user._id, actorName: req.user.name || "Client", milestoneId: milestone._id, milestoneTitle: milestone.title, note: feedback });
      await project.save();
      publishProject(project);
      await notifyUser(project.freelancer, "milestone", "Revision requested", `The client requested changes to ${milestone.title}.`, `/milestones/${project._id}`, "revisions");
      res.json({ message: "Revision requested", project });
    } catch (error) {
      res.status(error.name === "VersionError" ? 409 : 500).json({ message: error.name === "VersionError" ? "Project changed. Reload before trying again." : "Server error" });
    }
  }
);

module.exports = router;
