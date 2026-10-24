const { aiConfig } = require("./aiProvider");
const MODEL = "text-embedding-3-small";
const MAX_CANDIDATES = 20;

const aiMatchingAvailable = () => Boolean(aiConfig().apiKey);

function projectText(project) {
  return `Project: ${project.title || ""}\nCategory: ${project.category || "Unspecified"}${project.category === "Other" && project.customCategory ? ` — ${project.customCategory}` : ""}\nRequired skills: ${(project.requiredSkills || []).join(", ")}\nBrief: ${project.description || ""}`.slice(0, 4000);
}

function applicantText(application) {
  const profile = application.freelancer?.profile || {};
  return `Skills: ${(profile.skills || []).join(", ")}\nHeadline: ${profile.headline || ""}\nExperience: ${profile.experienceYears || 0} years\nBio: ${profile.bio || ""}\nProposal: ${application.proposal || ""}`.slice(0, 4000);
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length < 2 || left.length !== right.length) {
    throw new Error("Invalid embedding dimensions");
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index];
    const b = right[index];
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("Invalid embedding values");
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (!leftMagnitude || !rightMagnitude) throw new Error("Empty embedding vector");
  const similarity = dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
  if (!Number.isFinite(similarity)) throw new Error("Invalid embedding values");
  return similarity;
}

async function embedTexts(texts, fetchImpl = fetch) {
  const config = aiConfig();
  if (!config.apiKey) throw new Error("AI matching is not configured");
  if (config.provider === "gemini") {
    const response = await fetchImpl("https://generativelanguage.googleapis.com/v1beta/models/" + config.matchingModel + ":batchEmbedContents", {
      method: "POST", headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ requests: texts.map(text => ({ model: "models/" + config.matchingModel, content: { parts: [{ text }] }, outputDimensionality: 768 })) }),
    });
    if (!response.ok) throw new Error("Embedding service is unavailable");
    const body = await response.json();
    if (!Array.isArray(body.embeddings) || body.embeddings.length !== texts.length || body.embeddings.some(item => !Array.isArray(item?.values))) throw new Error("Embedding response is incomplete");
    return body.embeddings.map(item => item.values);
  }
  const response = await fetchImpl("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts, encoding_format: "float" }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Embedding service returned ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.data) || body.data.length !== texts.length) throw new Error("Embedding response is incomplete");
  const ordered = [...body.data].sort((a, b) => (a?.index ?? -1) - (b?.index ?? -1));
  if (ordered.some((item, index) => item?.index !== index || !Array.isArray(item?.embedding))) {
    throw new Error("Embedding response is invalid");
  }
  return ordered.map(item => item.embedding);
}

async function rankApplicants(project, applications, fetchImpl = fetch) {
  if (!applications.length || applications.length > MAX_CANDIDATES) throw new Error(`Analyze between 1 and ${MAX_CANDIDATES} pending applicants`);
  if (applications.some(application => !application?._id || !Number.isFinite(application.match?.score) || application.match.score < 0 || application.match.score > 100)) throw new Error("Invalid applicant comparison data");
  const texts = [projectText(project), ...applications.map(applicantText)];
  const vectors = await embedTexts(texts, fetchImpl);
  const ranking = applications.map((application, index) => {
    const similarity = cosineSimilarity(vectors[0], vectors[index + 1]);
    const semanticScore = Math.round(Math.max(0, Math.min(1, similarity)) * 100);
    const ruleScore = application.match.score;
    const score = Math.round(0.6 * semanticScore + 0.4 * ruleScore);
    return {
      applicationId: application._id.toString(),
      score,
      semanticScore,
      ruleScore,
      matchedSkills: application.match.matchedSkills,
      missingSkills: application.match.missingSkills,
      yearsExperience: application.match.yearsExperience,
      trustIncluded: application.match.trustIncluded,
      evidence: application.trust ? {
        score: application.trust.score,
        approvedMilestones: application.trust.approvedMilestones,
        scoredMilestones: application.trust.scoredMilestones,
        clientCount: application.trust.clientCount,
        revisionRequests: application.trust.revisionRequests,
      } : null,
    };
  }).sort((a, b) => b.score - a.score || a.applicationId.localeCompare(b.applicationId));
  return {
    method: "embedding_cosine_v1",
    provider: aiConfig().provider,
    model: aiConfig().matchingModel,
    explanation: "Ranking aid: 60% text similarity and 40% explainable regular fit across required skills, profile-led project context, self-reported experience and verified work. Scores are not hiring probabilities or decisions. Review the full proposal before deciding.",
    ranking: ranking.map((item, index) => ({ rank: index + 1, ...item })),
  };
}

module.exports = { MODEL, MAX_CANDIDATES, aiMatchingAvailable, projectText, applicantText, cosineSimilarity, embedTexts, rankApplicants };
