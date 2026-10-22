const express = require("express");
const mongoose = require("mongoose");
const { route, commit, fail, note } = require("../projectMutation");
const { normalizeChange, applyChange } = require("../projectChanges");
const { notifyUser } = require("../notifications");

const router = express.Router();
async function notifyOther(req, project, title) {
  const other = String(project.client) === String(req.user._id) ? project.freelancer : project.client;
  await notifyUser(other, "case", title, "Review the proposed scope, schedule, milestone amounts and recorded response in your project workroom.", `/milestones/${project._id}`);
}

router.post("/:projectId/changes", ...route(async (req, project) => {
  if (project.status !== "In Progress" || !project.freelancer) fail(409, "Only an active assigned project can receive a change request");
  if (project.pendingCancellation || project.pendingAmendment) fail(409, "Resolve the pending cancellation or change request first");
  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 10 || reason.length > 1000) fail(400, "Explain the change in 10–1000 characters");
  let terms;
  try { terms = normalizeChange(project, req.body.terms); } catch (error) { fail(400, error.message); }
  const id = new mongoose.Types.ObjectId();
  const changed = await commit(project, {
    $set: { pendingAmendment: id },
    $push: { amendments: { _id: id, requestedBy: req.user._id, requesterName: req.user.name, reason, terms, status: "Pending" }, activity: note(req, "change_requested", reason) },
  });
  await notifyOther(req, project, "Project change requested");
  return { message: "Change request sent. Current terms remain unchanged; milestone changes pause until a response.", project: changed };
}));

router.post("/:projectId/changes/:changeId/respond", ...route(async (req, project) => {
  if (!mongoose.isValidObjectId(req.params.changeId)) fail(404, "Change request not found");
  const proposal = project.amendments.id(req.params.changeId);
  if (!proposal) fail(404, "Change request not found");
  if (project.status !== "In Progress" || proposal.status !== "Pending" || String(project.pendingAmendment) !== String(proposal._id)) fail(409, "This change request is no longer pending");
  const action = req.body.action;
  const own = String(proposal.requestedBy) === String(req.user._id);
  if (!["accept", "decline", "withdraw"].includes(action)) fail(400, "Choose accept, decline or withdraw");
  if ((own && action !== "withdraw") || (!own && action === "withdraw")) fail(403, "Only the other participant may accept or decline; only the requester may withdraw");
  const response = typeof req.body.response === "string" ? req.body.response.trim() : "";
  if (response.length < 10 || response.length > 1000) fail(400, "Add a response of 10–1000 characters");
  const prefix = `amendments.${project.amendments.indexOf(proposal)}`;
  const status = { accept: "Accepted", decline: "Declined", withdraw: "Withdrawn" }[action];
  const set = { pendingAmendment: null, [`${prefix}.status`]: status, [`${prefix}.response`]: response, [`${prefix}.respondedBy`]: req.user._id, [`${prefix}.responderName`]: req.user.name, [`${prefix}.respondedAt`]: new Date() };
  if (action === "accept") {
    let terms;
    try { terms = normalizeChange(project, proposal.terms); } catch (error) { fail(409, `Request a fresh change: ${error.message}`); }
    set[`${prefix}.before`] = { scope: project.description, amount: project.budget, deliveryDate: project.deadline, milestones: project.milestones.map(step => step.toObject()), hasExplicitDependencies: project.hasExplicitDependencies };
    Object.assign(set, { description: terms.scope, budget: terms.amount, deadline: terms.deliveryDate, milestones: applyChange(project, terms), hasExplicitDependencies: true });
  }
  const changed = await commit(project, { $set: set, $push: { activity: note(req, `change_${status.toLowerCase()}`, response) } });
  await notifyOther(req, project, `Project change ${status.toLowerCase()}`);
  return { message: action === "accept" ? "Change agreed by both participants. Updated terms are active; the original agreement and work history are retained." : `Change ${status.toLowerCase()}. Existing terms remain active.`, project: changed };
}));

module.exports = router;
