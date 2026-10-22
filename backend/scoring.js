const { toCents } = require("./money");
const skillAliases = new Map([
  ["reactjs", "react"], ["react.js", "react"], ["react js", "react"],
  ["node", "node.js"], ["nodejs", "node.js"], ["node js", "node.js"],
  ["vuejs", "vue"], ["vue.js", "vue"], ["vue js", "vue"],
]);
const normalizeSkill = value => {
  const skill = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  return skillAliases.get(skill) || skill;
};

const contextStopWords = new Set("a an and are as at be by can clear create deliver for from in into is it of on or project that the their this to with will work your".split(" "));

function contextTokens(value) {
  return [...new Set((String(value || "").toLowerCase().match(/[a-z0-9]+/g) || [])
    .map(token => {
      if (token.length < 3 || contextStopWords.has(token)) return "";
      if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
      if (token.endsWith("s") && token.length > 4 && !token.endsWith("ss")) return token.slice(0, -1);
      return token;
    })
    .filter(Boolean))];
}

function contextFactor(project, profile, proposal, requiredSkills) {
  if (!project) return { score: null, profileScore: null, proposalScore: null, matchedTerms: [] };
  const skillTerms = new Set(requiredSkills.flatMap(skill => contextTokens(skill)));
  const projectTerms = contextTokens(`${project.title || ""} ${project.description || ""}`).filter(term => !skillTerms.has(term));
  if (!projectTerms.length) return { score: null, profileScore: null, proposalScore: null, matchedTerms: [] };

  const profileTerms = new Set(contextTokens(`${profile.headline || ""} ${profile.bio || ""}`));
  const proposalTerms = new Set(contextTokens(proposal));
  const profileCoverage = projectTerms.filter(term => profileTerms.has(term)).length / projectTerms.length;
  const proposalCoverage = projectTerms.filter(term => proposalTerms.has(term)).length / projectTerms.length;
  const matchedTerms = projectTerms.filter(term => profileTerms.has(term) || proposalTerms.has(term));
  return {
    score: Math.round((profileCoverage * 0.8 + proposalCoverage * 0.2) * 100),
    profileScore: Math.round(profileCoverage * 100),
    proposalScore: Math.round(proposalCoverage * 100),
    matchedTerms,
  };
}

// Only platform-verified approvals and revision requests affect this score.
// No history is shown as unscored, and a small sample is pulled toward 60.
function trustFromProjects(projects = []) {
  let approvedMilestones = 0;
  let revisionRequests = 0;
  let completedProjects = 0;
  const evidenceByClient = new Map();
  const knownClients = new Set();

  const missingClientKey = Symbol("missing-client");
  for (const project of projects) {
    if (project.status === "Completed") completedProjects += 1;
    const clientId = project.client?.toString();
    const key = clientId || missingClientKey;
    const evidence = evidenceByClient.get(key) || { approved: 0, revised: 0 };
    for (const milestone of project.milestones || []) {
      if (milestone.status !== "completed") continue;
      approvedMilestones += 1;
      evidence.approved += 1;
      const revisions = Math.max(0, Number(milestone.revisionCount) || 0);
      revisionRequests += revisions;
      if (revisions) evidence.revised += 1;
    }
    if (evidence.approved) {
      evidenceByClient.set(key, evidence);
      if (clientId) knownClients.add(clientId);
    }
  }

  if (!approvedMilestones) {
    return { score: null, label: "New on FreelanceChain", approvedMilestones: 0, completedProjects, revisionRequests: 0, scoredMilestones: 0, clientCount: 0 };
  }

  // Each client can contribute at most three approval-equivalents, even across
  // projects. Revised approvals fill those slots first, so extra clean steps
  // cannot dilute an existing revision within the same client account.
  let scoredMilestones = 0;
  let scoredRevisions = 0;
  for (const evidence of evidenceByClient.values()) {
    const weight = Math.min(3, evidence.approved);
    scoredMilestones += weight;
    scoredRevisions += Math.min(weight, evidence.revised);
  }
  const revisionRate = scoredRevisions / scoredMilestones;
  const observedScore = 100 - 60 * revisionRate;
  const evidenceWeight = scoredMilestones / (scoredMilestones + 4);
  const score = Math.round(60 + evidenceWeight * (observedScore - 60));
  return {
    score,
    label: knownClients.size < 2 ? "Limited client history" : "Multiple client accounts",
    approvedMilestones,
    completedProjects,
    revisionRequests,
    scoredMilestones,
    clientCount: knownClients.size,
  };
}

function matchApplicant(requiredSkills = [], profile = {}, trust = { score: null }, context = {}) {
  const required = [...new Map(requiredSkills.map(skill => [normalizeSkill(skill), String(skill).trim()]).filter(([key]) => key)).values()];
  const freelancerSkills = new Set((profile.skills || []).map(normalizeSkill));
  const matchedSkills = required.filter(skill => freelancerSkills.has(normalizeSkill(skill)));
  const missingSkills = required.filter(skill => !freelancerSkills.has(normalizeSkill(skill)));
  const years = Math.max(0, Number(profile.experienceYears) || 0);
  const contextMatch = contextFactor(context.project, profile, context.proposal, required);

  const factors = [];
  if (required.length) factors.push({ weight: 70, value: matchedSkills.length / required.length });
  factors.push({ weight: 15, value: Math.min(1, years / 5) });
  if (trust.score !== null && Number.isFinite(trust.score)) factors.push({ weight: 15, value: trust.score / 100 });
  const weighted = factors.reduce((sum, factor) => sum + factor.weight * factor.value, 0);
  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const baseScore = Math.round((weighted / totalWeight) * 100 / 5) * 5;
  const score = contextMatch.score === null
    ? baseScore
    : Math.round((baseScore * 0.65 + contextMatch.score * 0.35) / 5) * 5;
  const budgetCents = toCents(context.project?.budget);
  const priceCents = toCents(context.proposedPrice);
  const budgetStatus = budgetCents !== null && budgetCents > 0 && priceCents !== null && priceCents > 0
    ? (priceCents <= budgetCents ? "within_budget" : "above_budget") : "unknown";
  const availability = ["available", "limited", "unavailable"].includes(profile.availability) ? profile.availability : "unknown";

  return {
    score,
    baseScore,
    compatibility: { budget: budgetStatus, availability, budgetDifference: budgetStatus === "unknown" ? null : (priceCents - budgetCents) / 100, method: "Proposal price compared with fixed project budget; availability is self-reported. Compatibility supports filtering and negotiation and does not change the fit score." },
    matchedSkills,
    missingSkills,
    yearsExperience: years,
    trustIncluded: trust.score !== null,
    contextScore: contextMatch.score,
    contextProfileScore: contextMatch.profileScore,
    contextProposalScore: contextMatch.proposalScore,
    contextMatchedTerms: contextMatch.matchedTerms,
    factorScores: {
      requiredSkills: required.length ? Math.round((matchedSkills.length / required.length) * 100) : null,
      context: contextMatch.score,
      experience: Math.round(Math.min(1, years / 5) * 100),
      verifiedTrust: trust.score !== null && Number.isFinite(trust.score) ? trust.score : null,
    },
    method: "Comparison aid: 65% skill, self-reported experience and verified-work fit plus 35% profile-led project-context term overlap. Missing platform history is not scored; context overlap is not semantic verification.",
  };
}

module.exports = { trustFromProjects, matchApplicant, normalizeSkill, skillAliases };
