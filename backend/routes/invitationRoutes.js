const express = require("express");
const mongoose = require("mongoose");
const Invitation = require("../models/Invitation");
const Application = require("../models/Application");
const Project = require("../models/Project");
const User = require("../models/User");
const { protect, allowRoles } = require("../middleware/authMiddleware");
const { publishUser } = require("../liveUpdates");
const { notifyUser } = require("../notifications");

const router = express.Router();
router.use(protect);

router.get("/mine", allowRoles("freelancer"), async (req, res) => {
  const invitations = await Invitation.find({ freelancer: req.user._id })
    .populate("project", "title description requiredSkills budget deadline status milestones.title milestones.payment")
    .populate("client", "name")
    .sort({ createdAt: -1 }).lean();
  res.json(invitations);
});

router.get("/sent", allowRoles("client"), async (req, res) => {
  const invitations = await Invitation.find({ client: req.user._id })
    .select("project freelancer status createdAt").sort({ createdAt: -1 }).lean();
  res.json(invitations);
});

router.post("/", allowRoles("client"), async (req, res) => {
  const { projectId, freelancerId, note } = req.body || {};
  const cleanNote = typeof note === "string" ? note.trim() : "";
  if (!mongoose.Types.ObjectId.isValid(projectId) || !mongoose.Types.ObjectId.isValid(freelancerId)) return res.status(400).json({ message: "Select a valid project and freelancer" });
  if (cleanNote.length < 10 || cleanNote.length > 1000) return res.status(400).json({ message: "Add a personal invitation of 10–1000 characters" });
  const [project, freelancer] = await Promise.all([
    Project.findById(projectId).select("client status freelancer title").lean(),
    User.findById(freelancerId).select("role profile.discoverable").lean(),
  ]);
  if (!project || project.client?.toString() !== req.user._id.toString()) return res.status(403).json({ message: "Access denied" });
  if (project.status !== "Open" || project.freelancer) return res.status(409).json({ message: "This project is no longer open" });
  if (!freelancer || freelancer.role !== "freelancer" || !freelancer.profile?.discoverable) return res.status(404).json({ message: "Freelancer is not available for invitations" });
  if (await Application.exists({ project: project._id, freelancer: freelancer._id })) return res.status(409).json({ message: "This freelancer has already applied" });
  try {
    const invitation = await Invitation.create({ project: project._id, client: req.user._id, freelancer: freelancer._id, note: cleanNote });
    publishUser(freelancer._id, "applications", project._id);
    await notifyUser(freelancer._id, "invitation", "New project invitation", `${req.user.name || "A client"} invited you to ${project.title}.`, "/freelancer-dashboard");
    res.status(201).json({ id: invitation._id, status: invitation.status });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "You have already invited this freelancer to the project" });
    res.status(500).json({ message: "Could not send invitation" });
  }
});

router.post("/:invitationId/decline", allowRoles("freelancer"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.invitationId)) return res.status(400).json({ message: "Invalid invitation" });
  const invitation = await Invitation.findOneAndUpdate(
    { _id: req.params.invitationId, freelancer: req.user._id, status: "PENDING" },
    { $set: { status: "DECLINED" } }, { returnDocument: "after" }
  );
  if (!invitation) return res.status(404).json({ message: "Invitation is no longer available" });
  publishUser(invitation.client, "applications", invitation.project);
  await notifyUser(invitation.client, "invitation", "Invitation declined", "A freelancer declined your project invitation.", "/client-dashboard");
  res.json({ status: invitation.status });
});

module.exports = router;
