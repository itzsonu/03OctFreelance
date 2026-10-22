const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { generateAiMilestones } = require("../aiPlanner");
const { rankApplicants, MODEL, aiMatchingAvailable } = require("../semanticMatching");

async function checkAi({ live = false, fetchImpl = global.fetch } = {}) {
  const status = { configured: aiMatchingAvailable(), liveRequested: live, planningModel: process.env.OPENAI_PLAN_MODEL || "gpt-4o-mini", matchingModel: MODEL };
  if (!live) return { ...status, liveVerified: false, message: "Configuration check only; no API calls made. Use --live for two requests with synthetic data." };
  if (!status.configured) return { ...status, liveVerified: false, message: "Set OPENAI_API_KEY privately in backend/.env first. Guided planning and regular matching remain available." };
  const project = { title: "Synthetic dashboard demo", description: "Build a responsive React dashboard showing synthetic weekly totals with a documented API.", category: "Web Development", requiredSkills: ["React", "Node.js"], budget: 1000, deadline: "2099-12-31" };
  // No database connection or user records; each feature is attempted once, with no retries.
  const result = { ...status, planningVerified: false, matchingVerified: false };
  try {
    const plan = await generateAiMilestones(project, { fetchImpl });
    result.planningVerified = plan.method === "ai_assisted" && plan.suggestions.length >= 2;
  } catch { result.planningMessage = "Planning check failed. Check the key, billing, model access and network; use the guided draft meanwhile."; }
  try {
    const comparison = await rankApplicants(project, [{ _id: "synthetic-applicant", proposal: "I can implement the React dashboard and document the Node.js API.", freelancer: { profile: { skills: ["React", "Node.js"], experienceYears: 2, bio: "Synthetic demonstration profile." } }, match: { score: 70, matchedSkills: ["React", "Node.js"], missingSkills: [], yearsExperience: 2, trustIncluded: false } }], fetchImpl);
    result.matchingVerified = comparison.ranking.length === 1 && Number.isFinite(comparison.ranking[0].score);
  } catch { result.matchingMessage = "Comparison check failed. Regular fit scores remain available; check the key, billing and network."; }
  return { ...result, liveVerified: result.planningVerified && result.matchingVerified };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--live") || args.length > 1) {
    console.error("Usage: npm run ai:check -- [--live]"); process.exitCode = 1;
  } else checkAi({ live: args.includes("--live") }).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (result.liveRequested && !result.liveVerified) process.exitCode = 1;
  }).catch(() => { console.error("AI check could not finish; no database changes were made."); process.exitCode = 1; });
}

module.exports = { checkAi };
