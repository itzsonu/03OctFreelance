const express = require("express");
const mongoose = require("mongoose");
const Project = require("../models/Project");
const Review = require("../models/Review");
const { protect } = require("../middleware/authMiddleware");
const { publishUser } = require("../liveUpdates");
const { notifyUser } = require("../notifications");

const router = express.Router();
router.use(protect);

async function completedProject(req, res, next) {
  if (!mongoose.Types.ObjectId.isValid(req.params.projectId)) return res.status(400).json({ message: "Invalid project" });
  const project = await Project.findById(req.params.projectId).select("client freelancer status").lean();
  if (!project || !project.freelancer) return res.status(404).json({ message: "Project not found" });
  const userId = req.user._id.toString();
  const clientId = project.client?.toString();
  const freelancerId = project.freelancer?.toString();
  if (userId !== clientId && userId !== freelancerId) return res.status(403).json({ message: "Access denied" });
  if (project.status !== "Completed") return res.status(409).json({ message: "Reviews open after the project is completed" });
  req.reviewContext = { project, reviewee: userId === clientId ? freelancerId : clientId };
  next();
}

const view = review => review && ({ id: review._id, rating: review.rating, text: review.text, reviewerRole: review.reviewerRole, createdAt: review.createdAt });

router.get("/project/:projectId", completedProject, async (req, res) => {
  const reviews = await Review.find({ project: req.reviewContext.project._id }).lean();
  const mine = reviews.find(review => review.reviewer.toString() === req.user._id.toString());
  const other = reviews.find(review => review.reviewer.toString() !== req.user._id.toString());
  res.json({ mine: view(mine) || null, other: mine && other ? view(other) : null, waitingForOther: Boolean(mine && !other) });
});

router.post("/project/:projectId", completedProject, async (req, res) => {
  const rating = Number(req.body?.rating);
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 10 || text.length > 1000) return res.status(400).json({ message: "Choose 1–5 stars and write 10–1000 characters" });
  try {
    const review = await Review.create({ project: req.reviewContext.project._id, reviewer: req.user._id, reviewee: req.reviewContext.reviewee, reviewerRole: req.user.role, rating, text });
    publishUser(req.reviewContext.reviewee, "project", req.reviewContext.project._id);
    await notifyUser(req.reviewContext.reviewee, "review", "Review submitted", "Your project partner has submitted a review. Add yours to reveal both reviews.", `/milestones/${req.reviewContext.project._id}`);
    res.status(201).json(view(review));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "You have already reviewed this project" });
    res.status(500).json({ message: "Could not save review" });
  }
});

module.exports = router;
