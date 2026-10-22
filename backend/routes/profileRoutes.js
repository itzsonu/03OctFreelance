const express = require("express");
const User = require("../models/User");
const Project = require("../models/Project");
const { trustFromProjects } = require("../scoring");
const { protect, allowRoles } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(protect);

router.get("/me", async (req, res) => {
  try {
    if (req.user.role === "client") return res.json({ name: req.user.name, company: req.user.company || { name: "", overview: "" } });
    if (req.user.role !== "freelancer") return res.status(403).json({ message: "Access denied" });
    const projects = await Project.find({ freelancer: req.user._id }).select("client status milestones.status milestones.revisionCount").lean();
    res.json({ name: req.user.name, profile: req.user.profile || {}, trust: trustFromProjects(projects) });
  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/me", async (req, res) => {
  try {
    if (req.user.role === "client") {
      const companyNameInput = req.body?.companyName;
      const companyOverviewInput = req.body?.companyOverview;
      if ((companyNameInput !== undefined && typeof companyNameInput !== "string") || (companyOverviewInput !== undefined && typeof companyOverviewInput !== "string")) return res.status(400).json({ message: "Company name and overview must be text" });
      const companyName = companyNameInput?.trim() || "";
      const companyOverview = companyOverviewInput?.trim() || "";
      if (companyName.length > 100 || companyOverview.length > 1000) return res.status(400).json({ message: "Company name or overview is too long" });
      const user = await User.findByIdAndUpdate(req.user._id, { $set: { "company.name": companyName, "company.overview": companyOverview } }, { returnDocument: "after", runValidators: true }).select("name company");
      return res.json({ name: user.name, company: user.company });
    }
    if (req.user.role !== "freelancer") return res.status(403).json({ message: "Access denied" });
    const { headline, bio, skills, experienceYears, portfolioUrl, portfolioItems, availability, hourlyRate, discoverable = false } = req.body || {};
    const cleanHeadline = typeof headline === "string" ? headline.trim() : "";
    const cleanBio = typeof bio === "string" ? bio.trim() : "";
    const cleanUrl = typeof portfolioUrl === "string" ? portfolioUrl.trim() : "";
    const years = Number(experienceYears);
    if (cleanHeadline.length > 100 || cleanBio.length > 1200) {
      return res.status(400).json({ message: "Headline or bio is too long" });
    }
    if (!Array.isArray(skills) || skills.length > 15 || skills.some(skill => typeof skill !== "string" || !skill.trim() || skill.trim().length > 40)) {
      return res.status(400).json({ message: "Add up to 15 valid skills" });
    }
    if (!Number.isInteger(years) || years < 0 || years > 60) {
      return res.status(400).json({ message: "Experience must be between 0 and 60 years" });
    }
    if (typeof discoverable !== "boolean") return res.status(400).json({ message: "Profile visibility must be on or off" });
    if (availability !== undefined && !["available", "limited", "unavailable"].includes(availability)) return res.status(400).json({ message: "Choose a valid availability" });
    if (hourlyRate !== undefined && hourlyRate !== null && (typeof hourlyRate === "boolean" || hourlyRate === "" || !Number.isFinite(Number(hourlyRate)) || Number(hourlyRate) < 0 || Number(hourlyRate) > 10000000)) {
      return res.status(400).json({ message: "Rate must be a non-negative number" });
    }
    if (portfolioItems !== undefined && (!Array.isArray(portfolioItems) || portfolioItems.length > 10 || portfolioItems.some(item => !item || typeof item !== "object" || typeof item.title !== "string" || !item.title.trim() || item.title.trim().length > 80 || typeof item.description !== "string" || item.description.trim().length > 300 || typeof item.url !== "string" || item.url.trim().length > 500))) {
      return res.status(400).json({ message: "Add up to 10 portfolio items with a title, short description and link" });
    }
    if (discoverable && (!cleanHeadline || !cleanBio || skills.length === 0)) {
      return res.status(400).json({ message: "Add a headline, bio and skill before appearing in talent search" });
    }
    if (cleanUrl) {
      try {
        const url = new URL(cleanUrl);
        if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid URL");
      } catch {
        return res.status(400).json({ message: "Portfolio must be a valid web URL" });
      }
    }
    const normalizedPortfolioItems = (portfolioItems || []).map(item => {
      const url = item.url.trim();
      if (!url) throw new Error("Portfolio links must be valid web URLs");
      try {
        const parsed = new URL(url);
        if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Invalid URL");
      } catch {
        throw new Error("Portfolio links must be valid web URLs");
      }
      return { title: item.title.trim(), description: item.description.trim(), url };
    });
    const normalizedSkills = [...new Set(skills.map(skill => skill.trim()).filter(Boolean))];
    const profileFields = {
      "profile.headline": cleanHeadline,
      "profile.bio": cleanBio,
      "profile.skills": normalizedSkills,
      "profile.experienceYears": years,
      "profile.portfolioUrl": cleanUrl,
      "profile.discoverable": discoverable,
    };
    if (portfolioItems !== undefined) profileFields["profile.portfolioItems"] = normalizedPortfolioItems;
    if (availability !== undefined) profileFields["profile.availability"] = availability;
    if (hourlyRate !== undefined) profileFields["profile.hourlyRate"] = hourlyRate === null ? null : Number(hourlyRate);
    const user = await User.findByIdAndUpdate(req.user._id, { $set: profileFields }, { returnDocument: "after", runValidators: true }).select("name profile");
    res.json({ name: user.name, profile: user.profile });
  } catch (error) {
    if (error.message === "Portfolio links must be valid web URLs") return res.status(400).json({ message: error.message });
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
