const { matchApplicant, trustFromProjects } = require("./scoring");
const { rankApplicants } = require("./semanticMatching");
const { aiConfig } = require("./aiProvider");

function sampleComparison() {
  const project = { title: "Write a beginner React API tutorial", category: "Writing & Translation", description: "Write and edit a beginner tutorial explaining React API requests, with an outline, clear examples and a final editorial review. The deliverable is an article, not a working application.", requiredSkills: ["Technical Writing", "Editing"], budget: 1000 };
  const profiles = [
    { id: "sample-writer", label: "Sample A · Technical writer", profile: { headline: "Technical writer and editor", skills: ["Technical Writing", "Editing"], experienceYears: 3, bio: "I write beginner tutorials and edit developer documentation with clear API examples." }, proposal: "I will outline the React API tutorial, write beginner-friendly explanations and edit the article for clarity." },
    { id: "sample-developer", label: "Sample B · React developer", profile: { headline: "React application developer", skills: ["React", "JavaScript"], experienceYears: 5, bio: "I build React dashboards and integrate APIs in working web applications." }, proposal: "I can build a React application with API requests and dashboard components." },
    { id: "sample-marketer", label: "Sample C · Marketing writer", profile: { headline: "Marketing copywriter", skills: ["Copywriting", "Editing"], experienceYears: 2, bio: "I write campaign copy and edit product launch announcements." }, proposal: "I will create persuasive promotional copy for the product launch." },
  ];
  const applicants = profiles.map(item => ({ _id: item.id, label: item.label, proposal: item.proposal, freelancer: { profile: item.profile }, trust: trustFromProjects([]) }));
  for (const item of applicants) item.match = matchApplicant(project.requiredSkills, item.freelancer.profile, item.trust, { project, proposal: item.proposal, proposedPrice: 1000 });
  return { synthetic: true, project, applicants };
}

// Only the fixed synthetic fixture is cached; never real applicant data.
function createDemoRunner({ rank = rankApplicants, now = Date.now } = {}) {
  let cached, pending, cooldownUntil = 0;
  return async function compare() {
    const config = aiConfig();
    const key = config.provider + ":" + config.matchingModel;
    if (cached?.key === key && cached.expires > now()) return { ...cached.result, cached: true };
    if (pending) return pending;
    if (cooldownUntil > now()) {
      const error = new Error("Please wait a minute before trying the sample AI comparison again. Regular fit scores remain available.");
      error.status = 429; error.aiProviderFailure = true; throw error;
    }
    cooldownUntil = now() + 60000;
    const sample = sampleComparison();
    pending = (async () => {
      const result = { ...await rank(sample.project, sample.applicants), synthetic: true, generatedAt: new Date(now()).toISOString() };
      cached = { key, expires: now() + 10 * 60000, result };
      return { ...result, cached: false };
    })();
    try { return await pending; } finally { pending = null; }
  };
}
module.exports = { sampleComparison, createDemoRunner };
