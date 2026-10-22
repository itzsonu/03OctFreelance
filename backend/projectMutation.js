const mongoose = require("mongoose");
const Project = require("./models/Project");
const { protect } = require("./middleware/authMiddleware");
const { publishProject, publishMarketplace } = require("./liveUpdates");
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const note = (req, type, text) => ({ type, actor: req.user._id, actorName: req.user.name, note: text, createdAt: new Date() });

function route(action, ownerOnly = false) {
  return [protect, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.projectId)) fail(404, "Project not found");
      const project = await Project.findById(req.params.projectId);
      if (!project) fail(404, "Project not found");
      const owner = req.user.role === "client" && String(project.client) === String(req.user._id);
      const assigned = req.user.role === "freelancer" && String(project.freelancer) === String(req.user._id);
      if ((!owner && !assigned) || (ownerOnly && !owner)) fail(403, "Access denied");
      if (!Number.isInteger(req.body?.version) || req.body.version < 0) fail(400, "Reload the project before making this change");
      if (req.body.version !== (project.__v || 0)) fail(409, "Project changed. Reload before trying again.");
      const result = await action(req, project);
      res.json(result);
    } catch (error) {
      if (!error.status) console.error("Project lifecycle failed:", error.message);
      res.status(error.status || (error.name === "ValidationError" ? 400 : 500)).json({ message: error.status || error.name === "ValidationError" ? error.message : "Unable to update project" });
    }
  }];
}

async function commit(project, update) {
  const version = project.__v === undefined ? { $or: [{ __v: 0 }, { __v: { $exists: false } }] } : { __v: project.__v };
  const changed = await Project.findOneAndUpdate({ _id: project._id, status: project.status, ...version }, { ...update, $inc: { ...update.$inc, __v: 1 } }, { returnDocument: "after", runValidators: true });
  if (!changed) fail(409, "Project changed. Reload before trying again.");
  publishProject(changed);
  publishMarketplace();
  return changed;
}


module.exports = { route, commit, fail, note };
