const express = require("express");
const mongoose = require("mongoose");
const Project = require("../models/Project");
const Application = require("../models/Application");
const { protect } = require("../middleware/authMiddleware");
const { normalizeProjectDraft, listingSnapshot } = require("../projectDraft");
const { validateSchedule } = require("../projectDates");
const { publishProject, publishMarketplace, publishUser } = require("../liveUpdates");
const { notifyUser } = require("../notifications");
const { hiringAvailable } = require("../moderation");

const router = express.Router();
const { route, commit, fail, note } = require("../projectMutation");
const unassigned = project => ["Open", "Closed"].includes(project.status) && !project.freelancer && !project.agreement;

async function notifyApplicants(project, title, message) {
  const applications = await Application.find({ project: project._id }).select("freelancer").lean();
  const users = new Set(applications.map(item => String(item.freelancer)));
  await Promise.all([...users].map(user => {
    publishUser(user, "applications", project._id);
    return notifyUser(user, "application", title, message, "/freelancer-dashboard");
  }));
}

router.patch("/:projectId/listing", ...route(async (req, project) => {
  if (!unassigned(project)) fail(409, "Only an unassigned project can be edited");
  let draft;
  try { draft = normalizeProjectDraft(req.body); } catch (error) { fail(400, error.message); }
  const changed = await commit(project, {
    $set: draft,
    $inc: { listingRevision: 1 },
    $push: {
      listingHistory: { revision: project.listingRevision || 0, actor: req.user._id, before: listingSnapshot(project) },
      activity: note(req, "listing_edited", "Project brief and milestone plan updated before hiring"),
    },
  });
  // A revision is also checked during assignment, including concurrent acceptance.
  await Application.updateMany({ project: project._id, status: "PENDING", currentOfferState: "OPEN", offers: { $elemMatch: { status: "OPEN", listingRevision: { $not: { $gte: changed.listingRevision } } } } },
    { $set: { currentOfferState: "STALE", "offers.$[old].status": "STALE" } },
    { arrayFilters: [{ "old.status": "OPEN", "old.listingRevision": { $not: { $gte: changed.listingRevision } } }] });
  await notifyApplicants(changed, "Project brief updated", "The client updated a project you applied to. Review its latest brief and agree to a fresh offer before starting work.");
  return { message: "Project updated. Previous offers need a fresh agreement.", project: changed };
}, true));

router.post("/:projectId/hiring", ...route(async (req, project) => {
  if (req.body.action === "reopen" && !await hiringAvailable(project)) fail(409, "An administrator has restricted this listing. It cannot be reopened until restored.");
  if (!unassigned(project)) fail(409, "Hiring can only change before a freelancer is assigned");
  const target = req.body.action === "close" ? "Closed" : req.body.action === "reopen" ? "Open" : null;
  if (!target) fail(400, "Choose close or reopen");
  if (project.status === target) fail(409, `Hiring is already ${target.toLowerCase()}`);
  if (target === "Open") {
    try { validateSchedule(project.deadline); } catch (error) { fail(400, "Update the project deadline before reopening hiring"); }
  }
  const changed = await commit(project, { $set: { status: target }, $push: { activity: note(req, target === "Open" ? "hiring_reopened" : "hiring_closed", target === "Open" ? "Hiring reopened" : "Hiring closed; existing proposals retained") } });
  await notifyApplicants(changed, target === "Open" ? "Hiring reopened" : "Hiring closed", target === "Open" ? "A project you applied to is open for hiring again." : "Hiring is paused on a project you applied to. Existing proposals are retained.");
  return { message: target === "Open" ? "Hiring reopened." : "Hiring closed. Existing proposals are retained.", project: changed };
}, true));

router.post("/:projectId/cancellations", ...route(async (req, project) => {
  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 10 || reason.length > 1000) fail(400, "Describe the cancellation reason in 10–1000 characters");
  if (!["Open", "Closed", "In Progress"].includes(project.status)) fail(409, "This project can no longer be cancelled");
  if (project.pendingCancellation || project.pendingAmendment) fail(409, "Respond to or withdraw the existing cancellation request first");
  const direct = unassigned(project);
  if (!direct && (!project.freelancer || project.status !== "In Progress")) fail(409, "Project is not available for cancellation");
  const id = new mongoose.Types.ObjectId();
  const request = { _id: id, requestedBy: req.user._id, requesterName: req.user.name, reason, status: direct ? "Accepted" : "Pending", ...(direct ? { respondedBy: req.user._id, responderName: req.user.name, response: "Cancelled before assignment", respondedAt: new Date() } : {}) };
  const changed = await commit(project, {
    $set: direct ? { status: "Cancelled", pendingCancellation: null } : { pendingCancellation: id },
    $push: { cancellationRequests: request, activity: note(req, direct ? "project_cancelled" : "cancellation_requested", reason) },
  });
  if (direct) await notifyApplicants(changed, "Project cancelled", "The client cancelled a project you applied to before hiring. Its proposals remain in your history.");
  else {
    const other = String(project.client) === String(req.user._id) ? project.freelancer : project.client;
    await notifyUser(other, "case", "Cancellation requested", `${req.user.name} requested project cancellation. Review the reason in your workroom.`, `/milestones/${project._id}`);
  }
  return { message: direct ? "Project cancelled. History retained." : "Cancellation requested. The other participant must respond; milestone changes are paused until then.", project: changed };
}));

router.post("/:projectId/cancellations/:requestId/respond", ...route(async (req, project) => {
  if (!mongoose.isValidObjectId(req.params.requestId)) fail(404, "Cancellation request not found");
  const request = project.cancellationRequests.id(req.params.requestId);
  if (!request) fail(404, "Cancellation request not found");
  if (project.status !== "In Progress" || request.status !== "Pending" || String(project.pendingCancellation) !== String(request._id)) fail(409, "This cancellation request is no longer pending");
  const own = String(request.requestedBy) === String(req.user._id);
  const action = req.body.action;
  if (!["accept", "decline", "withdraw"].includes(action)) fail(400, "Choose accept, decline or withdraw");
  if ((own && action !== "withdraw") || (!own && action === "withdraw")) fail(403, "Only the other participant may accept or decline; only the requester may withdraw");
  const response = typeof req.body.response === "string" ? req.body.response.trim() : "";
  if (response.length < 10 || response.length > 1000) fail(400, "Add a response of 10–1000 characters");
  const status = { accept: "Accepted", decline: "Declined", withdraw: "Withdrawn" }[action];
  const prefix = `cancellationRequests.${project.cancellationRequests.indexOf(request)}`;
  const changed = await commit(project, {
    $set: { pendingCancellation: null, ...(action === "accept" ? { status: "Cancelled" } : {}), [`${prefix}.status`]: status, [`${prefix}.response`]: response, [`${prefix}.respondedBy`]: req.user._id, [`${prefix}.responderName`]: req.user.name, [`${prefix}.respondedAt`]: new Date() },
    $push: { activity: note(req, action === "accept" ? "project_cancelled" : `cancellation_${action === "decline" ? "declined" : "withdrawn"}`, response) },
  });
  const other = String(project.client) === String(req.user._id) ? project.freelancer : project.client;
  await notifyUser(other, "case", `Cancellation ${status.toLowerCase()}`, "A project cancellation request received a response. Review the recorded reason and response in your workroom.", `/milestones/${project._id}`);
  return { message: action === "accept" ? "Project cancelled by mutual agreement. Work history is retained." : `Cancellation ${status.toLowerCase()}. Milestone work can continue.`, project: changed };
}));

module.exports = router;
