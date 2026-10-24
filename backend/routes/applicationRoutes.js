const express = require("express");
const mongoose = require("mongoose");
const Application = require("../models/Application");
const Project = require("../models/Project");
const Invitation = require("../models/Invitation");
const { protect, allowRoles } = require("../middleware/authMiddleware");
const { trustFromProjects, matchApplicant } = require("../scoring");
const { aiMatchingAvailable, MAX_CANDIDATES, rankApplicants } = require("../semanticMatching");
const { aiStatus } = require("../aiProvider");
const { publishUser, publishProject, publishMarketplace } = require("../liveUpdates");
const { notifyUser } = require("../notifications");
const { toCents } = require("../money");
const { buildMilestones } = require("../workflow");
const { todayISO, validDate, validateSchedule } = require("../projectDates");
const { pagination, listResponse } = require("../pagination");
const { hiringAvailable } = require("../moderation");

const { sampleComparison, createDemoRunner } = require("../aiComparisonDemo");
const compareSample = createDemoRunner();
const router = express.Router();

const isValidId = (value) => mongoose.Types.ObjectId.isValid(value);
const aiAnalysisAttempts = new Map();

function normalizedOfferTerms(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["scope", "amount", "deliveryDate", "milestones"].includes(key))) return null;
  const scope = typeof input.scope === "string" ? input.scope.trim() : "";
  const amount = Number(input.amount);
  const deliveryDate = input.deliveryDate;
  const today = todayISO();
  if (scope.length < 10 || scope.length > 5000 || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000 || toCents(amount) === null || !validDate(deliveryDate) || deliveryDate < today) return null;
  if (!Array.isArray(input.milestones) || input.milestones.length < 1 || input.milestones.length > 20) return null;
  const milestones = [];
  for (const item of input.milestones) {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some(key => !["title", "description", "payment", "dueDate", "dependsOn"].includes(key))) return null;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const description = typeof item.description === "string" ? item.description.trim() : "";
    const payment = Number(item.payment);
    const dueDate = item.dueDate === undefined || item.dueDate === "" ? "" : item.dueDate;
    const index = milestones.length;
    const dependsOn = item.dependsOn === undefined ? (index ? [index - 1] : []) : item.dependsOn;
    if (!Array.isArray(dependsOn) || dependsOn.some(prior => !Number.isInteger(prior) || prior < 0 || prior >= index) || new Set(dependsOn).size !== dependsOn.length) return null;
    if (!title || title.length > 120 || description.length > 1000 || !Number.isFinite(payment) || payment < 0 || payment > 1_000_000_000 || toCents(payment) === null || (dueDate && (!validDate(dueDate) || dueDate < today || dueDate > deliveryDate))) return null;
    milestones.push({ title, description, payment, dueDate, dependsOn: [...dependsOn].sort((a, b) => a - b) });
  }
  const milestoneTotal = milestones.reduce((sum, item) => sum + toCents(item.payment), 0);
  if (milestoneTotal !== toCents(amount)) return null;
  try { validateSchedule(deliveryDate, milestones); } catch { return null; }
  return { scope, amount, deliveryDate, milestones };
}

async function offerContext(req, res) {
  if (!isValidId(req.params.applicationId)) {
    res.status(400).json({ message: "Invalid application ID" });
    return null;
  }
  const application = await Application.findById(req.params.applicationId);
  if (!application) {
    res.status(404).json({ message: "Application not found" });
    return null;
  }
  const project = await Project.findById(application.project);
  if (!project) {
    res.status(404).json({ message: "Project not found" });
    return null;
  }
  const userId = String(req.user._id);
  const isClient = String(project.client) === userId && req.user.role === "client";
  const isFreelancer = String(application.freelancer) === userId && req.user.role === "freelancer";
  if (!isClient && !isFreelancer) {
    res.status(403).json({ message: "Access denied" });
    return null;
  }
  if (application.status !== "PENDING" || project.status !== "Open" || project.freelancer || !await hiringAvailable(project, application.freelancer)) {
    res.status(409).json({ message: "Hiring is closed for this proposal" });
    return null;
  }
  return { application, project, isClient, isFreelancer };
}

async function loadApplicants(project) {
  const applications = await Application.find({ project: project._id })
    .populate("freelancer", "name suspended profile.headline profile.bio profile.skills profile.experienceYears profile.portfolioUrl profile.availability")
    .sort({ createdAt: -1, _id: -1 });
  const freelancerIds = applications.map(application => application.freelancer?._id).filter(Boolean);
  const workHistory = freelancerIds.length
    ? await Project.find({ freelancer: { $in: freelancerIds } }).select("freelancer client status milestones.status milestones.revisionCount").lean()
    : [];
  const projectsByFreelancer = new Map();
  for (const previousProject of workHistory) {
    const id = previousProject.freelancer.toString();
    projectsByFreelancer.set(id, [...(projectsByFreelancer.get(id) || []), previousProject]);
  }
  return applications.map(application => {
    const data = application.toObject();
    if (!application.freelancer) return { ...data, trust: null, match: null };
    const trust = trustFromProjects(projectsByFreelancer.get(application.freelancer._id.toString()) || []);
    return {
      ...data,
      trust,
      match: matchApplicant(project.requiredSkills || [], application.freelancer.profile || {}, trust, { project, proposal: application.proposal, proposedPrice: application.proposedPrice }),
    };
  });
}

router.post("/", protect, allowRoles("freelancer"), async (req, res) => {
  try {
    const { projectId, proposal = "", proposedPrice, deliveryEstimateDays, portfolioLinks = [], answers = [] } = req.body;
    const normalizedProposal = typeof proposal === "string" ? proposal.trim() : "";

    if (!projectId || !isValidId(projectId)) {
      return res.status(400).json({ message: "A valid project ID is required" });
    }

    if (typeof proposal !== "string" || normalizedProposal.length > 2000) {
      return res.status(400).json({ message: "Proposal must be 2000 characters or fewer" });
    }

    if (!normalizedProposal) {
      return res.status(400).json({ message: "Proposal is required" });
    }

    const price = Number(proposedPrice);
    const estimate = Number(deliveryEstimateDays);
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000_000 || toCents(price) === null) {
      return res.status(400).json({ message: "Proposed price must be a positive amount with at most two decimal places" });
    }
    if (!Number.isInteger(estimate) || estimate < 1 || estimate > 3650) {
      return res.status(400).json({ message: "Delivery estimate must be between 1 and 3650 days" });
    }
    if (!Array.isArray(portfolioLinks) || portfolioLinks.length > 5 || portfolioLinks.some(link => {
      if (typeof link !== "string" || link.trim().length > 300) return true;
      try { return !["http:", "https:"].includes(new URL(link.trim()).protocol); } catch { return true; }
    })) return res.status(400).json({ message: "Add up to five valid HTTP or HTTPS portfolio links" });
    if (!Array.isArray(answers) || answers.length > 10 || answers.some(item => !item || Object.keys(item).some(key => !["question", "answer"].includes(key)) || typeof item.question !== "string" || !item.question.trim() || item.question.trim().length > 300 || typeof item.answer !== "string" || !item.answer.trim() || item.answer.trim().length > 1000)) {
      return res.status(400).json({ message: "Add up to ten complete question and answer pairs" });
    }

    const project = await Project.findById(projectId).select("client status freelancer title moderationHidden");

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    if (project.status !== "Open" || project.freelancer || !await hiringAvailable(project)) {
      return res.status(409).json({ message: "Applications are closed for this project" });
    }

    const application = await Application.create({
      project: projectId,
      freelancer: req.user._id,
      proposal: normalizedProposal,
      proposedPrice: price,
      deliveryEstimateDays: estimate,
      portfolioLinks: portfolioLinks.map(link => link.trim()),
      answers: answers.map(item => ({ question: item.question.trim(), answer: item.answer.trim() })),
    });

    await Invitation.updateOne({ project: projectId, freelancer: req.user._id, status: "PENDING" }, { $set: { status: "RESPONDED" } });

    publishUser(project.client, "applications", project._id);
    await notifyUser(project.client, "application", "New proposal received", `${req.user.name || "A freelancer"} applied to ${project.title}.`, "/client-dashboard", "proposals");

    res.status(201).json({
      message: "Application submitted successfully",
      application,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "You have already applied to this project" });
    }

    res.status(500).json({ message: "Server error" });
  }
});

router.get("/mine", protect, allowRoles("freelancer"), async (req, res) => {
  try {
    const paging = pagination(req.query);
    const applications = await Application.find({ freelancer: req.user._id })
      .populate("project", "title status freelancer listingRevision moderationHidden")
      .sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.pageSize);
    const [total, pending] = await Promise.all([Application.countDocuments({ freelancer: req.user._id }), Application.countDocuments({ freelancer: req.user._id, status: "PENDING" })]);
    listResponse(res, applications, total, paging, { summary: { pending } });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load applications" });
  }
});

router.get("/ai-status", protect, allowRoles("client"), (req, res) => {
  res.json({ ...aiStatus(), maxCandidates: MAX_CANDIDATES });
});

router.get("/ai-demo", protect, allowRoles("client"), (req, res) => {
  res.json({ ...sampleComparison(), ...aiStatus() });
});

router.post("/ai-demo", protect, allowRoles("client"), async (req, res) => {
  if (Object.keys(req.body || {}).length) return res.status(400).json({ message: "The demo accepts only its fixed sample profiles" });
  if (!aiMatchingAvailable()) return res.status(503).json({ message: "AI is not configured. Regular sample scores remain available." });
  try { res.json(await compareSample()); }
  catch (error) {
    res.status(error.aiProviderFailure ? error.status : 502).json({ message: error.aiProviderFailure ? error.message : "AI comparison could not finish. Regular sample scores remain available." });
  }
});

router.get(
  "/project/:projectId",
  protect,
  allowRoles("client"),
  async (req, res) => {
    try {
      const { projectId } = req.params;

      if (!isValidId(projectId)) {
        return res.status(400).json({ message: "Invalid project ID" });
      }

      const project = await Project.findById(projectId).select("client title description category customCategory requiredSkills budget");

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      if (project.client.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: "Access denied" });
      }

      const paging = pagination(req.query);
      if (req.query.shortlisted !== undefined && !["true", "false"].includes(req.query.shortlisted)) return res.status(400).json({ message: "Invalid shortlist filter" });
      if (req.query.budget && !["within_budget", "above_budget", "unknown"].includes(req.query.budget)) return res.status(400).json({ message: "Invalid budget compatibility" });
      if (req.query.availability && !["available", "limited", "unavailable", "unknown"].includes(req.query.availability)) return res.status(400).json({ message: "Invalid availability" });
      const all = (await loadApplicants(project)).sort((a, b) => (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1) || Number(Boolean(b.shortlisted)) - Number(Boolean(a.shortlisted)) || (b.match?.score ?? -1) - (a.match?.score ?? -1) || new Date(b.createdAt) - new Date(a.createdAt) || String(b._id).localeCompare(String(a._id)));
      const filtered = all.filter(item => (req.query.shortlisted !== "true" || item.shortlisted) && (!req.query.budget || (item.match?.compatibility?.budget || "unknown") === req.query.budget) && (!req.query.availability || (item.match?.compatibility?.availability || "unknown") === req.query.availability));
      listResponse(res, filtered.slice(paging.skip, paging.skip + paging.pageSize), filtered.length, paging, { summary: { all: all.length, pending: all.filter(item => item.status === "PENDING" && !item.freelancer?.suspended).length, shortlisted: all.filter(item => item.shortlisted).length } });
    } catch (error) {
      res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to load applicants" });
    }
  }
);

router.post("/project/:projectId/ai-rank", protect, allowRoles("client"), async (req, res) => {
  try {
    if (!isValidId(req.params.projectId)) return res.status(400).json({ message: "Invalid project ID" });
    const project = await Project.findById(req.params.projectId).select("client title description category customCategory requiredSkills budget status moderationHidden");
    if (!project) return res.status(404).json({ message: "Project not found" });
    if (project.client.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Access denied" });
    if (project.status !== "Open" || !await hiringAvailable(project)) return res.status(409).json({ message: "AI analysis is available while hiring is open" });
    if (!aiMatchingAvailable()) return res.status(503).json({ message: "AI analysis is not configured on this server" });
    if (await Application.countDocuments({ project: project._id, status: "PENDING" }) > MAX_CANDIDATES) return res.status(400).json({ message: `AI analysis supports 1–${MAX_CANDIDATES} pending applicants` });
    const pending = (await loadApplicants(project)).filter(application => application.status === "PENDING" && application.freelancer && !application.freelancer.suspended && application.match);
    if (!pending.length || pending.length > MAX_CANDIDATES) {
      return res.status(400).json({ message: `AI analysis supports 1–${MAX_CANDIDATES} pending applicants` });
    }
    const attemptKey = `${req.user._id}:${project._id}`;
    const now = Date.now();
    if ((aiAnalysisAttempts.get(attemptKey) || 0) > now) {
      return res.status(429).json({ message: "Please wait a minute before running AI comparison again" });
    }
    aiAnalysisAttempts.set(attemptKey, now + 60 * 1000);
    if (aiAnalysisAttempts.size > 10000) aiAnalysisAttempts.delete(aiAnalysisAttempts.keys().next().value);
    res.json(await rankApplicants(project, pending));
  } catch (error) {
    console.error("AI applicant analysis failed:", error.message);
    res.status(error.aiProviderFailure ? error.status : 502).json({ message: error.aiProviderFailure ? error.message : "AI analysis is unavailable right now. The regular shortlist is still available." });
  }
});

router.patch("/:applicationId/shortlist", protect, allowRoles("client"), async (req, res) => {
  try {
    if (typeof req.body?.shortlisted !== "boolean") return res.status(400).json({ message: "Choose whether this applicant is shortlisted" });
    if (!isValidId(req.params.applicationId)) return res.status(400).json({ message: "Invalid application ID" });
    const application = await Application.findById(req.params.applicationId);
    if (!application) return res.status(404).json({ message: "Application not found" });
    const project = await Project.findById(application.project).select("client status freelancer");
    if (!project || String(project.client) !== String(req.user._id)) return res.status(403).json({ message: "Access denied" });
    if (project.status !== "Open" || project.freelancer || application.status !== "PENDING") return res.status(409).json({ message: "Only pending applicants can be shortlisted while hiring is open" });
    const updated = await Application.findOneAndUpdate(
      { _id: application._id, status: "PENDING" },
      { $set: { shortlisted: req.body.shortlisted, shortlistedAt: req.body.shortlisted ? new Date() : null, shortlistedBy: req.body.shortlisted ? req.user._id : null } },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(409).json({ message: "Application is no longer pending" });
    publishUser(application.freelancer, "applications", project._id);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: "Could not update shortlist" });
  }
});

router.patch("/:applicationId", protect, allowRoles("freelancer"), async (req, res) => {
  try {
    const context = await offerContext(req, res);
    if (!context) return;
    if (!context.isFreelancer) return res.status(403).json({ message: "Access denied" });
    const allowed = ["proposal", "proposedPrice", "deliveryEstimateDays", "portfolioLinks", "answers"];
    if (Object.keys(req.body || {}).some(key => !allowed.includes(key))) return res.status(400).json({ message: "Unsupported proposal fields" });
    const proposal = typeof req.body.proposal === "string" ? req.body.proposal.trim() : "";
    const price = Number(req.body.proposedPrice);
    const estimate = Number(req.body.deliveryEstimateDays);
    const { portfolioLinks = [], answers = [] } = req.body;
    if (!proposal || proposal.length > 2000 || !Number.isFinite(price) || price <= 0 || price > 1_000_000_000 || toCents(price) === null) return res.status(400).json({ message: "Add a proposal and valid proposed price" });
    if (!Number.isInteger(estimate) || estimate < 1 || estimate > 3650) return res.status(400).json({ message: "Delivery estimate must be between 1 and 3650 days" });
    if (!Array.isArray(portfolioLinks) || portfolioLinks.length > 5 || portfolioLinks.some(link => {
      if (typeof link !== "string" || link.trim().length > 300) return true;
      try { return !["http:", "https:"].includes(new URL(link.trim()).protocol); } catch { return true; }
    })) return res.status(400).json({ message: "Add up to five valid HTTP or HTTPS portfolio links" });
    if (!Array.isArray(answers) || answers.length > 10 || answers.some(item => !item || Object.keys(item).some(key => !["question", "answer"].includes(key)) || typeof item.question !== "string" || !item.question.trim() || item.question.trim().length > 300 || typeof item.answer !== "string" || !item.answer.trim() || item.answer.trim().length > 1000)) return res.status(400).json({ message: "Add up to ten complete question and answer pairs" });
    const application = context.application;
    const update = {
      $set: {
        proposal,
        proposedPrice: price,
        deliveryEstimateDays: estimate,
        portfolioLinks: portfolioLinks.map(link => link.trim()),
        answers: answers.map(item => ({ question: item.question.trim(), answer: item.answer.trim() })),
      },
      $inc: { proposalRevision: 1 },
    };
    const arrayFilters = [];
    if (application.currentOfferState === "OPEN" && application.currentOfferId) {
      update.$set.currentOfferState = "STALE";
      update.$set["offers.$[active].status"] = "STALE";
      update.$push = { offerEvents: { offer: application.currentOfferId, version: application.offers.id(application.currentOfferId)?.version || 1, actor: req.user._id, action: "staled", createdAt: new Date() } };
      arrayFilters.push({ "active._id": application.currentOfferId, "active.status": "OPEN" });
    }
    const updated = await Application.findOneAndUpdate(
      { _id: application._id, status: "PENDING", currentOfferState: { $ne: "AGREED" } },
      update,
      { returnDocument: "after", ...(arrayFilters.length ? { arrayFilters } : {}) }
    );
    if (!updated) return res.status(409).json({ message: "Proposal can no longer be changed" });
    publishUser(context.project.client, "applications", context.project._id);
    await notifyUser(context.project.client, "application", application.currentOfferState === "OPEN" ? "Proposal updated; offer withdrawn" : "Proposal updated", `The freelancer updated their proposal for ${context.project.title}.${application.currentOfferState === "OPEN" ? " The previous offer is no longer active." : ""}`, "/client-dashboard", "proposals");
    res.json({ message: "Proposal updated", application: updated, invalidatedOffer: application.currentOfferState === "OPEN" });
  } catch (error) {
    res.status(500).json({ message: "Could not update proposal" });
  }
});

router.post("/:applicationId/withdraw", protect, allowRoles("freelancer"), async (req, res) => {
  try {
    const context = await offerContext(req, res);
    if (!context) return;
    if (!context.isFreelancer) return res.status(403).json({ message: "Access denied" });
    const application = context.application;
    const update = { $set: { status: "WITHDRAWN" } };
    const arrayFilters = [];
    if (application.currentOfferState === "OPEN" && application.currentOfferId) {
      update.$set.currentOfferState = "STALE";
      update.$set["offers.$[active].status"] = "STALE";
      update.$push = { offerEvents: { offer: application.currentOfferId, version: application.offers.id(application.currentOfferId)?.version || 1, actor: req.user._id, action: "staled", createdAt: new Date() } };
      arrayFilters.push({ "active._id": application.currentOfferId, "active.status": "OPEN" });
    }
    const updated = await Application.findOneAndUpdate(
      { _id: application._id, status: "PENDING", currentOfferState: { $ne: "AGREED" } },
      update,
      { returnDocument: "after", ...(arrayFilters.length ? { arrayFilters } : {}) }
    );
    if (!updated) return res.status(409).json({ message: "Proposal can no longer be withdrawn" });
    publishUser(context.project.client, "applications", context.project._id);
    await notifyUser(context.project.client, "application", "Proposal withdrawn", `A freelancer withdrew their proposal for ${context.project.title}.`, "/client-dashboard", "proposals");
    res.json({ message: "Proposal withdrawn", application: updated });
  } catch (error) {
    res.status(500).json({ message: "Could not withdraw proposal" });
  }
});

router.post("/:applicationId/offer", protect, async (req, res) => {
  try {
    const context = await offerContext(req, res);
    if (!context) return;
    const { application, project, isClient, isFreelancer } = context;
    if ((isClient && req.user.role !== "client") || (isFreelancer && req.user.role !== "freelancer")) return res.status(403).json({ message: "Access denied" });
    const terms = normalizedOfferTerms(req.body?.terms);
    if (!terms) return res.status(400).json({ message: "Provide valid scope, amount, delivery date and milestones whose planned amounts add up to the total" });
    const replacingOfferId = req.body?.replacesOfferId || null;
    if (replacingOfferId && !isValidId(replacingOfferId)) return res.status(400).json({ message: "Invalid offer version" });
    const activeOffer = application.currentOfferState === "OPEN" ? application.offers.id(application.currentOfferId) : null;
    if (activeOffer && String(replacingOfferId) !== String(activeOffer._id)) return res.status(409).json({ message: "The offer changed; review the latest version before countering" });
    if (!activeOffer && replacingOfferId) return res.status(409).json({ message: "There is no active offer to replace" });
    if (!activeOffer && !isClient) return res.status(409).json({ message: "The client must make the first offer" });
    const now = new Date();
    const offerId = new mongoose.Types.ObjectId();
    const version = application.offers.length + 1;
    const nextOffer = {
      _id: offerId,
      version,
      listingRevision: project.listingRevision || 0,
      terms,
      createdBy: req.user._id,
      createdAt: now,
      status: "OPEN",
      acceptances: [{ actor: req.user._id, acceptedAt: now }],
    };
    const currentState = application.currentOfferState || "NONE";
    const events = [
      ...(activeOffer ? [{ offer: activeOffer._id, version: activeOffer.version, actor: req.user._id, action: String(activeOffer.createdBy) === String(req.user._id) ? "staled" : "countered", createdAt: now }] : []),
      { offer: offerId, version, actor: req.user._id, action: "proposed", createdAt: now },
    ];
    const offers = application.offers.map(item => {
      const previous = item.toObject();
      if (activeOffer && String(previous._id) === String(activeOffer._id)) previous.status = "STALE";
      return previous;
    });
    offers.push(nextOffer);
    const update = {
      $set: { currentOfferId: offerId, currentOfferState: "OPEN", offers },
      $push: {
        offerEvents: { $each: events },
      },
    };
    const query = { _id: application._id, status: "PENDING", currentOfferState: currentState === "NONE" ? { $in: ["NONE", null] } : currentState, currentOfferId: application.currentOfferId || null };
    const updated = await Application.findOneAndUpdate(query, update, { returnDocument: "after" });
    if (!updated) return res.status(409).json({ message: "The proposal or offer changed; reload before making another offer" });
    const recipient = isClient ? application.freelancer : project.client;
    publishUser(recipient, "applications", project._id);
    await notifyUser(recipient, "application", activeOffer ? "Counter-offer received" : "Project offer received", `${req.user.name || "The other participant"} proposed terms for ${project.title}.`, isClient ? "/freelancer-dashboard" : "/client-dashboard", "offers");
    res.status(201).json({ message: "Offer version created", application: updated });
  } catch (error) {
    res.status(500).json({ message: "Could not create offer" });
  }
});

router.post("/:applicationId/offer/:offerId/accept", protect, async (req, res) => {
  try {
    const context = await offerContext(req, res);
    if (!context) return;
    if (!isValidId(req.params.offerId)) return res.status(400).json({ message: "Invalid offer version" });
    const { application, project } = context;
    const offered = application.offers.id(req.params.offerId);
    if (offered && (offered.listingRevision || 0) !== (project.listingRevision || 0)) return res.status(409).json({ message: "The project brief changed. Review it and request a fresh offer." });
    if (offered) { try { validateSchedule(offered.terms.deliveryDate, offered.terms.milestones); } catch (error) { return res.status(409).json({ message: "The offer schedule has expired. Request a fresh offer." }); } }
    const now = new Date();
    const accepted = await Application.findOneAndUpdate(
      {
        _id: application._id,
        status: "PENDING",
        currentOfferId: req.params.offerId,
        currentOfferState: "OPEN",
        offers: { $elemMatch: { _id: req.params.offerId, status: "OPEN", createdBy: { $ne: req.user._id } } },
      },
      {
        $set: { currentOfferState: "AGREED", "offers.$.status": "AGREED" },
        $push: {
          "offers.$.acceptances": { actor: req.user._id, acceptedAt: now },
          offerEvents: { offer: new mongoose.Types.ObjectId(req.params.offerId), version: application.offers.id(req.params.offerId)?.version || 1, actor: req.user._id, action: "accepted", createdAt: now },
        },
      },
      { returnDocument: "after" }
    );
    if (!accepted) return res.status(409).json({ message: "This offer is stale, already answered, or not addressed to you" });
    const agreedOffer = accepted.offers.id(req.params.offerId);
    const clientAcceptance = agreedOffer.acceptances.find(item => String(item.actor) === String(project.client));
    const freelancerAcceptance = agreedOffer.acceptances.find(item => String(item.actor) === String(application.freelancer));
    if (!clientAcceptance || !freelancerAcceptance) return res.status(409).json({ message: "Both participants must agree to the same offer version" });
    const agreementTerms = agreedOffer.terms.toObject();
    agreementTerms.milestones = agreementTerms.milestones.map((item, index) => ({ ...item, dependsOn: item.dependsOn ?? (index ? [index - 1] : []) }));
    const agreedMilestones = buildMilestones(agreementTerms.milestones).map((item, index) => ({ ...item, dueDate: agreementTerms.milestones[index].dueDate || "" }));
    const assigned = await Project.findOneAndUpdate(
      { _id: project._id, client: project.client, status: "Open", freelancer: null, __v: project.__v || 0, ...(project.listingRevision ? { listingRevision: project.listingRevision } : { $or: [{ listingRevision: 0 }, { listingRevision: { $exists: false } }] }) },
      {
        $set: {
          freelancer: application.freelancer,
          status: "In Progress",
          description: agreedOffer.terms.scope,
          budget: agreedOffer.terms.amount,
          deadline: agreedOffer.terms.deliveryDate,
          hasExplicitDependencies: true,
          milestones: agreedMilestones,
          agreement: {
            application: application._id,
            offer: agreedOffer._id,
            version: agreedOffer.version,
            terms: agreementTerms,
            client: { actor: clientAcceptance.actor, agreedAt: clientAcceptance.acceptedAt },
            freelancer: { actor: freelancerAcceptance.actor, agreedAt: freelancerAcceptance.acceptedAt },
            agreedAt: now,
          },
        },
        $inc: { __v: 1 },
        $push: { activity: { type: "freelancer_assigned", actor: req.user._id, actorName: req.user.name || "Project participant", note: "Both participants agreed to the same offer version" } },
      },
      { returnDocument: "after", overwriteImmutable: true }
    );
    if (!assigned) {
      const latestProject = await Project.findById(project._id).select("freelancer").lean();
      await Application.findOneAndUpdate(
        { _id: accepted._id, status: "PENDING", currentOfferId: agreedOffer._id, currentOfferState: "AGREED" },
        { $set: { status: latestProject?.freelancer ? "REJECTED" : "PENDING", currentOfferState: "STALE", "offers.$[agreed].status": "STALE" }, $push: { offerEvents: { offer: agreedOffer._id, version: agreedOffer.version, actor: req.user._id, action: "staled", createdAt: new Date() } } },
        { arrayFilters: [{ "agreed._id": agreedOffer._id, "agreed.status": "AGREED" }] }
      );
      await notifyUser(application.freelancer, "application", "Project is no longer available", "The project changed or hiring closed before agreement was finalized. Review its latest status.", "/freelancer-dashboard");
      return res.status(409).json({ message: "Project changed or hiring closed before assignment; this offer is now stale" });
    }
    const finalApplication = await Application.findOneAndUpdate(
      { _id: accepted._id, status: "PENDING", currentOfferId: agreedOffer._id, currentOfferState: "AGREED" },
      { $set: { status: "ACCEPTED" } },
      { returnDocument: "after" }
    );
    if (!finalApplication) return res.status(409).json({ message: "Project was assigned, but application state changed unexpectedly; contact support" });
    const otherPending = await Application.find({ project: project._id, _id: { $ne: accepted._id }, status: "PENDING" }).select("freelancer").lean();
    await Application.updateMany(
      { project: project._id, _id: { $ne: accepted._id }, status: "PENDING" },
      { $set: { status: "REJECTED", currentOfferState: "STALE", "offers.$[open].status": "STALE" } },
      { arrayFilters: [{ "open.status": "OPEN" }] }
    );
    publishProject(assigned);
    publishMarketplace();
    publishUser(project.client, "applications", project._id);
    publishUser(application.freelancer, "applications", project._id);
    await Promise.all([
      notifyUser(project.client, "application", "Terms agreed; freelancer assigned", `You and ${req.user.role === "freelancer" ? req.user.name : "the freelancer"} agreed to version ${agreedOffer.version} for ${project.title}.`, `/milestones/${project._id}`, "offers"),
      notifyUser(application.freelancer, "application", "Terms agreed; project assigned", `You and the client agreed to version ${agreedOffer.version} for ${project.title}.`, `/milestones/${project._id}`, "offers"),
      ...otherPending.map(candidate => notifyUser(candidate.freelancer, "application", "Project hired another freelancer", `${project.title} is no longer accepting proposals.`, "/freelancer-dashboard")),
    ]);
    res.json({ message: "Terms agreed and freelancer assigned", application: finalApplication, project: assigned });
  } catch (error) {
    res.status(500).json({ message: "Could not finalize agreement" });
  }
});

router.post("/:applicationId/offer/:offerId/decline", protect, async (req, res) => {
  try {
    const context = await offerContext(req, res);
    if (!context) return;
    if (!isValidId(req.params.offerId)) return res.status(400).json({ message: "Invalid offer version" });
    const { application, project } = context;
    const offer = application.offers.id(req.params.offerId);
    if (!offer || String(application.currentOfferId) !== String(offer._id) || application.currentOfferState !== "OPEN" || String(offer.createdBy) === String(req.user._id)) return res.status(409).json({ message: "This offer is stale or not addressed to you" });
    const now = new Date();
    const updated = await Application.findOneAndUpdate(
      { _id: application._id, status: "PENDING", currentOfferId: offer._id, currentOfferState: "OPEN", offers: { $elemMatch: { _id: offer._id, status: "OPEN" } } },
      { $set: { status: "REJECTED", currentOfferState: "DECLINED", "offers.$.status": "DECLINED" }, $push: { offerEvents: { offer: offer._id, version: offer.version, actor: req.user._id, action: "declined", createdAt: now } } },
      { returnDocument: "after" }
    );
    if (!updated) return res.status(409).json({ message: "Offer changed; reload before declining" });
    const recipient = String(offer.createdBy) === String(project.client) ? application.freelancer : project.client;
    publishUser(recipient, "applications", project._id);
    await notifyUser(recipient, "application", "Project offer declined", `${req.user.name || "The other participant"} declined terms for ${project.title}.`, recipient.toString() === String(application.freelancer) ? "/freelancer-dashboard" : "/client-dashboard", "offers");
    res.json({ message: "Offer declined", application: updated });
  } catch (error) {
    res.status(500).json({ message: "Could not decline offer" });
  }
});

const updateApplicationStatus = async (req, res, status) => {
  try {
    if (status !== "REJECTED") return res.status(409).json({ message: "Direct assignment is disabled. Propose terms and obtain freelancer acceptance first." });
    if (!isValidId(req.params.applicationId)) return res.status(400).json({ message: "Invalid application ID" });
    const application = await Application.findById(req.params.applicationId);
    if (!application) return res.status(404).json({ message: "Application not found" });
    const project = await Project.findById(application.project);
    if (!project) return res.status(404).json({ message: "Project not found" });
    if (String(project.client) !== String(req.user._id)) return res.status(403).json({ message: "Access denied" });
    if (project.status !== "Open" || project.freelancer || application.status !== "PENDING") return res.status(409).json({ message: "Application is no longer pending" });
    const now = new Date();
    const update = { $set: { status: "REJECTED" } };
    const arrayFilters = [];
    const activeOffer = application.currentOfferState === "OPEN" && application.currentOfferId ? application.offers.id(application.currentOfferId) : null;
    if (activeOffer) {
      update.$set.currentOfferState = "DECLINED";
      update.$set["offers.$[active].status"] = "DECLINED";
      update.$push = { offerEvents: { offer: activeOffer._id, version: activeOffer.version, actor: req.user._id, action: "declined", createdAt: now } };
      arrayFilters.push({ "active._id": activeOffer._id, "active.status": "OPEN" });
    }
    const updated = await Application.findOneAndUpdate(
      { _id: application._id, status: "PENDING", currentOfferState: { $ne: "AGREED" } },
      update,
      { returnDocument: "after", ...(arrayFilters.length ? { arrayFilters } : {}) }
    );
    if (!updated) return res.status(409).json({ message: "Application is no longer pending" });
    publishUser(application.freelancer, "applications", project._id);
    publishUser(project.client, "applications", project._id);
    await notifyUser(application.freelancer, "application", "Proposal not selected", `Your proposal for ${project.title} was not selected.`, "/freelancer-dashboard", "proposals");
    res.json({ message: "Application rejected", application: updated });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

router.patch(
  "/:applicationId/accept",
  protect,
  allowRoles("client"),
  (req, res) => res.status(409).json({ message: "Direct assignment is disabled. Propose terms and obtain freelancer acceptance first." })
);

router.patch(
  "/:applicationId/reject",
  protect,
  allowRoles("client"),
  (req, res) => updateApplicationStatus(req, res, "REJECTED")
);

module.exports = router;
