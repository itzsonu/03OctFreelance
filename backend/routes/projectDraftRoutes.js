const express = require("express");
const mongoose = require("mongoose");
const Draft = require("../models/ProjectDraft");
const Project = require("../models/Project");
const { protect, allowRoles } = require("../middleware/authMiddleware");
const { savedForm, publishInput } = require("../savedProjectDraft");
const { normalizeProjectDraft } = require("../projectDraft");
const { publishProject, publishMarketplace } = require("../liveUpdates");
const router = express.Router();
router.use(protect, allowRoles("client"));
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const route = action => async (req, res) => { try { await action(req, res); } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to save project draft. Please try again." }); } };
const validate = action => { try { return action(); } catch (error) { fail(400, error.message); } };
async function owned(req) {
  if (!mongoose.isValidObjectId(req.params.id)) fail(404, "Draft not found");
  const draft = await Draft.findOne({ _id: req.params.id, client: req.user._id });
  if (!draft) fail(404, "Draft not found");
  return draft;
}
function version(req, draft) {
  if (!Number.isInteger(req.body?.version) || req.body.version !== draft.__v) fail(409, "Draft changed in another tab. Reopen it before saving.");
}

router.get("/", route(async (req, res) => {
  const drafts = await Draft.find({ client: req.user._id, state: { $ne: "published" } }).select("form.title updatedAt state __v").sort({ updatedAt: -1 }).limit(50).lean();
  res.json({ drafts });
}));
router.post("/", route(async (req, res) => {
  const form = validate(() => savedForm(req.body?.form));
  if (await Draft.countDocuments({ client: req.user._id, state: { $ne: "published" } }) >= 50) fail(400, "You have 50 saved drafts. Publish or delete one first.");
  const draft = await Draft.create({ client: req.user._id, form });
  res.status(201).json({ draft });
}));
router.get("/:id", route(async (req, res) => { res.json({ draft: await owned(req) }); }));
router.patch("/:id", route(async (req, res) => {
  const current = await owned(req); version(req, current);
  if (current.state !== "draft") fail(409, "This draft is being published or has already been published. Reopen it to continue.");
  const form = validate(() => savedForm(req.body?.form));
  const draft = await Draft.findOneAndUpdate({ _id: current._id, client: req.user._id, __v: req.body.version, state: "draft" }, { $set: { form }, $inc: { __v: 1 } }, { returnDocument: "after" });
  if (!draft) fail(409, "Draft changed. Reopen it before saving.");
  res.json({ draft });
}));
router.delete("/:id", route(async (req, res) => {
  const current = await owned(req); version(req, current);
  const deleted = await Draft.deleteOne({ _id: current._id, client: req.user._id, __v: req.body.version, state: "draft" });
  if (!deleted.deletedCount) fail(409, "Draft changed or is being published. Reopen it before deleting.");
  res.json({ message: "Draft deleted" });
}));
router.post("/:id/publish", route(async (req, res) => {
  await Project.init();
  let draft = await owned(req);
  // The permanent source ID makes a retry safe even if the previous response was lost.
  const existing = await Project.findOne({ sourceDraft: draft._id, client: req.user._id });
  if (existing) {
    await Draft.updateOne({ _id: draft._id }, { $set: { state: "published", publishedProject: existing._id } });
    return res.json({ project: existing });
  }
  version(req, draft);
  const terms = validate(() => normalizeProjectDraft(publishInput(draft.form)));
  if (draft.state === "draft") {
    draft = await Draft.findOneAndUpdate({ _id: draft._id, client: req.user._id, __v: req.body.version, state: "draft" }, { $set: { state: "publishing" }, $inc: { __v: 1 } }, { returnDocument: "after" });
    if (!draft) fail(409, "Draft changed. Reopen it before publishing.");
  } else if (draft.state !== "publishing") fail(409, "Draft has already been published");
  let project;
  try {
    project = await Project.findOneAndUpdate({ sourceDraft: draft._id }, { $setOnInsert: { ...terms, client: req.user._id, sourceDraft: draft._id, activity: [{ type: "project_created", actor: req.user._id, actorName: req.user.name || "Client", note: "Project published from saved draft" }] } }, { upsert: true, returnDocument: "after", runValidators: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    project = await Project.findOne({ sourceDraft: draft._id, client: req.user._id });
    if (!project) throw error;
  }
  await Draft.updateOne({ _id: draft._id }, { $set: { state: "published", publishedProject: project._id } });
  publishProject(project); publishMarketplace();
  res.json({ project });
}));
module.exports = router;
