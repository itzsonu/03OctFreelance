const { JOB_CATEGORIES } = require("./projectCategories");
const { normalizeSkill, skillAliases } = require("./scoring");

function profileSetup(profile = {}) {
  profile = profile || {};
  const steps = [
    { key: "intro", label: "Introduce your work", done: Boolean(profile.headline?.trim() && profile.bio?.trim()) },
    { key: "skills", label: "Add your skills", done: Boolean(profile.skills?.length) },
    { key: "preferences", label: "Choose preferred work and availability", done: Boolean(profile.preferredCategories?.length && ["available", "limited", "unavailable"].includes(profile.availability)) },
    { key: "samples", label: "Add a portfolio or practice project", optional: true, done: Boolean(profile.portfolioUrl || profile.portfolioItems?.length) },
  ];
  const required = steps.filter(step => !step.optional);
  return { steps, completed: required.filter(step => step.done).length, total: required.length, ready: required.every(step => step.done), discoverable: Boolean(profile.discoverable) };
}

// Match the same aliases/whitespace as the ordinary applicant comparison.
function mongoSkill(input) {
  const normalized = { $trim: { input: { $reduce: {
    input: { $regexFindAll: { input: { $toLower: { $ifNull: [input, ""] } }, regex: "\\S+" } },
    initialValue: "", in: { $concat: ["$$value", " ", "$$this.match"] },
  } } } };
  return { $let: { vars: { normalized }, in: { $switch: {
    branches: [...skillAliases].map(([alias, skill]) => ({ case: { $eq: ["$$normalized", alias] }, then: skill })),
    default: "$$normalized",
  } } } };
}

function recommendationStages(profile = {}) {
  const skills = [...new Set((profile.skills || []).map(normalizeSkill).filter(Boolean))];
  const categories = (profile.preferredCategories || []).filter(item => JOB_CATEGORIES.includes(item));
  return [
    { $set: { _skillKeys: { $setUnion: [{ $map: { input: { $ifNull: ["$requiredSkills", []] }, as: "skill", in: mongoSkill("$$skill") } }, []] }, _categoryMatch: { $in: [{ $ifNull: ["$category", "Other"] }, { $literal: categories }] } } },
    { $set: { _matchedKeys: { $setIntersection: ["$_skillKeys", { $literal: skills }] } } },
    { $set: { _matchedCount: { $size: "$_matchedKeys" }, _requiredCount: { $size: "$_skillKeys" } } },
    { $match: { $or: [{ _matchedCount: { $gt: 0 } }, { _categoryMatch: true }] } },
    { $set: { _hasSkillMatch: { $gt: ["$_matchedCount", 0] }, _coverage: { $cond: [{ $gt: ["$_requiredCount", 0] }, { $divide: ["$_matchedCount", "$_requiredCount"] }, 0] } } },
  ];
}

function recommendationReason(project, profile = {}) {
  const skills = new Set((profile.skills || []).map(normalizeSkill));
  return {
    matchedSkills: [...new Set((project.requiredSkills || []).filter(skill => skills.has(normalizeSkill(skill))))],
    preferredField: (profile.preferredCategories || []).includes(project.category || "Other"),
  };
}

function historyStages(history) {
  if (!history) return [];
  return [
    { $lookup: { from: "projects", let: { person: "$_id" }, pipeline: [
      { $match: { $expr: { $eq: ["$freelancer", "$$person"] }, "milestones.status": "completed" } },
      { $limit: 1 }, { $project: { _id: 1 } },
    ], as: "_approvedWork" } },
    { $match: { "_approvedWork.0": { $exists: history === "recorded" } } },
  ];
}

module.exports = { profileSetup, mongoSkill, recommendationStages, recommendationReason, historyStages };
