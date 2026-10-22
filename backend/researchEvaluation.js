const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateDataset, cases: diagnosticCases, holdoutCases } = require("./matchingEvaluation");
const { matchApplicant, trustFromProjects } = require("./scoring");
const { rankApplicants, aiMatchingAvailable } = require("./semanticMatching");
const MIN_CASES = 5;
const K = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const token = (value, prefix) => typeof value === "string" && new RegExp(`^${prefix}-[a-z0-9]{2,32}$`, "i").test(value);
const record = value => value && typeof value === "object" && !Array.isArray(value);
const onlyKeys = (value, keys, label) => {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Invalid or unsupported fields at ${label}`);
};
const normal = text => String(text).toLowerCase().replace(/\s+/g, " ").trim();
const projectFingerprint = project => hash(JSON.stringify([normal(project.description), [...project.requiredSkills].map(normal).sort()]));

function validateHistory(history) {
  if (history === undefined) return;
  onlyKeys(history, ["recordedBeforeCase", "projects"], "history");
  if (history.recordedBeforeCase !== true || !Array.isArray(history.projects) || history.projects.length > 50) throw new Error("History must be a bounded platform snapshot recorded before this case");
  for (const project of history.projects) {
    onlyKeys(project, ["clientToken", "status", "milestones"], "history project");
    if (!token(project.clientToken, "client") || !["Completed", "In Progress"].includes(project.status) || !Array.isArray(project.milestones) || project.milestones.length > 50) throw new Error("Invalid history project");
    for (const step of project.milestones) {
      onlyKeys(step, ["status", "revisionCount"], "history milestone");
      if (!["completed", "active", "locked", "submitted", "revision_requested"].includes(step.status) || !Number.isInteger(step.revisionCount) || step.revisionCount < 0 || step.revisionCount > 1000) throw new Error("Invalid history milestone");
    }
  }
}

function validateResearchDataset(input) {
  onlyKeys(input, ["schemaVersion", "provenance", "cases"], "dataset");
  if (input.schemaVersion !== 2) throw new Error("Research schemaVersion must be 2");
  const p = input.provenance;
  onlyKeys(p, ["sourceType", "datasetToken", "consented", "anonymized", "independentLabels", "scoresHiddenDuringLabelling", "reviewerCount", "holdoutUnusedForTuning", "split", "externalProcessingConsented"], "provenance");
  if (!["synthetic", "independent_consented"].includes(p.sourceType) || !token(p.datasetToken, "dataset") || !["development", "holdout"].includes(p.split) || p.anonymized !== true || !Number.isInteger(p.reviewerCount) || p.reviewerCount < 0 || p.reviewerCount > 20) throw new Error("Invalid dataset provenance");
  for (const key of ["consented", "independentLabels", "scoresHiddenDuringLabelling", "holdoutUnusedForTuning", "externalProcessingConsented"]) if (typeof p[key] !== "boolean") throw new Error(`Declare ${key} explicitly`);
  if (p.sourceType === "independent_consented" && (!p.consented || !p.independentLabels || !p.scoresHiddenDuringLabelling || p.reviewerCount < 2 || (p.split === "holdout" && !p.holdoutUnusedForTuning))) throw new Error("Real research data requires consent, independent blinded labels from two reviewers, and an unused holdout declaration");
  if (p.sourceType === "synthetic" && p.consented) throw new Error("Synthetic fixtures must not claim participant consent");
  if (!Array.isArray(input.cases) || input.cases.length < 1 || input.cases.length > 1000) throw new Error("Supply 1–1000 labelled cases; an empty collection template is not research data");
  const groups = new Set();
  const fingerprints = new Set();
  for (const item of input.cases) {
    onlyKeys(item, ["caseId", "groupToken", "project", "candidates", "relevantApplicantIds"], "case");
    if (!token(item.groupToken, "group") || groups.has(item.groupToken)) throw new Error("Use one case per independent project group");
    groups.add(item.groupToken);
    if (!Array.isArray(item.candidates)) throw new Error("Supply candidate records");
    for (const candidate of item.candidates) {
      onlyKeys(candidate, ["id", "experienceGroup", "profile", "proposal", "history"], "candidate");
      validateHistory(candidate.history);
    }
  }
  // Reuse v1 bounds and identifier/text checks; these internal flags only enable
  // structural validation of fictional data, and never replace v2 provenance.
  validateDataset({ schemaVersion: 1, consented: true, anonymized: true, cases: input.cases.map(item => ({
    caseId: item.caseId, project: item.project, relevantApplicantIds: item.relevantApplicantIds,
    candidates: item.candidates.map(({ history, ...candidate }) => candidate),
  })) });
  const tuned = new Set([...diagnosticCases, ...holdoutCases].map(item => projectFingerprint(item.project)));
  for (const item of input.cases) {
    if (!item.project.requiredSkills.length) throw new Error("Research cases require at least one reviewed required skill");
    for (const candidate of item.candidates) {
      if (candidate.experienceGroup !== undefined && candidate.experienceGroup !== (candidate.profile.experienceYears <= 1 ? "new" : "experienced")) throw new Error("Experience group must follow the frozen 0–1 versus 2+ years rubric");
    }
    const fingerprint = projectFingerprint(item.project);
    if (fingerprints.has(fingerprint)) throw new Error("Repeated project content cannot count as independent cases");
    if (p.sourceType === "independent_consented" && p.split === "holdout" && tuned.has(fingerprint)) throw new Error("Legacy tuned examples cannot be reused as an independent holdout");
    fingerprints.add(fingerprint);
  }
  return input;
}

function checkOverlap(holdout, development) {
  validateResearchDataset(development);
  if (development.provenance.split !== "development") throw new Error("The comparison dataset must be marked development");
  const ids = new Set(development.cases.map(item => item.caseId));
  const groups = new Set(development.cases.map(item => item.groupToken));
  const fingerprints = new Set(development.cases.map(item => projectFingerprint(item.project)));
  if (holdout.cases.some(item => ids.has(item.caseId) || groups.has(item.groupToken) || fingerprints.has(projectFingerprint(item.project)))) throw new Error("Holdout overlaps development data by case, source group or project content");
}

function wilsonInterval(successes, total) {
  if (!total) return null;
  const z = 1.959963984540054;
  const proportion = successes / total;
  const divisor = 1 + z * z / total;
  const center = (proportion + z * z / (2 * total)) / divisor;
  const spread = z * Math.sqrt(proportion * (1 - proportion) / total + z * z / (4 * total * total)) / divisor;
  return [Math.max(0, center - spread), Math.min(1, center + spread)].map(value => Math.round(value * 10000) / 100);
}

function rankingMetrics(ranking, relevantIds) {
  const relevant = new Set(relevantIds);
  const first = ranking.findIndex(item => relevant.has(item.id));
  const top = ranking.slice(0, K);
  const dcg = top.reduce((sum, item, index) => sum + (relevant.has(item.id) ? 1 / Math.log2(index + 2) : 0), 0);
  const ideal = Array.from({ length: Math.min(K, relevant.size) }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0);
  const tied = ranking.filter(item => item.score === ranking[0].score);
  return { hit: relevant.has(ranking[0].id), reciprocalRank: first < 0 ? 0 : 1 / (first + 1), recallAt3: top.filter(item => relevant.has(item.id)).length / relevant.size, ndcgAt3: dcg / ideal, tiedTop: tied.length > 1, tieNeutralHit: tied.filter(item => relevant.has(item.id)).length / tied.length };
}

function aggregate(rows, hasLabels = true) {
  const n = rows.length;
  const hits = rows.filter(row => row.hit).length;
  const enough = n >= MIN_CASES && hasLabels;
  const mean = key => enough ? Math.round(rows.reduce((sum, row) => sum + Number(row[key]), 0) / n * 10000) / 10000 : null;
  return { sampleSize: n, status: enough ? "descriptive_metrics" : n < MIN_CASES ? "insufficient_data" : "incomplete_group_labels", correctTop1: hits, top1HitRate: mean("hit"), meanReciprocalRank: mean("reciprocalRank"), meanRecallAt3: mean("recallAt3"), meanNdcgAt3: mean("ndcgAt3"), tiedTopCaseCount: rows.filter(row => row.tiedTop).length, tieNeutralTop1HitRate: mean("tieNeutralHit"), top1Wilson95Percent: enough ? wilsonInterval(hits, n) : null };
}

function summary(rows) {
  const split = key => [...new Set(rows.map(row => row[key]))].sort().map(group => ({ group, ...aggregate(rows.filter(row => row[key] === group), !/^(?:missing_|mixed$)/.test(group)) }));
  return { ...aggregate(rows), byCategory: split("category"), byRelevantPlatformHistory: split("historyGroup"), byRelevantExperience: split("experienceGroup"), selectedApplicantHistoryCounts: rows.reduce((counts, row) => ({ ...counts, [row.selectedHistory]: (counts[row.selectedHistory] || 0) + 1 }), {}) };
}

function trustFor(candidate) {
  return trustFromProjects((candidate.history?.projects || []).map(project => ({ client: project.clientToken, status: project.status, milestones: project.milestones })));
}
const historyGroup = (candidate, trust) => candidate.history === undefined ? "missing_history_snapshot" : trust.score === null ? "no_approved_platform_history" : "has_approved_platform_history";
function resultRow(item, ranking, applications) {
  const relevant = item.candidates.filter(candidate => item.relevantApplicantIds.includes(candidate.id));
  const oneGroup = values => new Set(values).size === 1 ? values[0] : "mixed";
  const selected = applications.find(application => application._id === ranking[0].id);
  return { ...rankingMetrics(ranking, item.relevantApplicantIds), category: item.project.category || "missing_category", historyGroup: oneGroup(relevant.map(candidate => historyGroup(candidate, trustFor(candidate)))), experienceGroup: oneGroup(relevant.map(candidate => candidate.experienceGroup || "missing_experience_label")), selectedHistory: selected.historyGroup };
}

function trustAudits() {
  const project = (client, count, revisions = 0, status = "completed") => ({ client, milestones: Array.from({ length: count }, () => ({ status, revisionCount: revisions })) });
  const trust = projects => trustFromProjects(projects);
  const score = projects => trust(projects).score;
  const mixed = count => [{ client: "same", milestones: [{ status: "completed", revisionCount: 1 }, ...project("same", count).milestones] }];
  const noHistoryMatch = matchApplicant(["React"], { skills: ["React"], experienceYears: 2 }, trust([]));
  const checks = [
    ["no_history_remains_unscored", trust([]).score === null && !noHistoryMatch.trustIncluded && noHistoryMatch.factorScores.verifiedTrust === null],
    ["unapproved_work_does_not_create_trust", score([project("one", 8, 0, "submitted")]) === null],
    ["repeated_revision_requests_are_capped", score([project("one", 1, 1)]) === score([project("one", 1, 50)])],
    ["one_client_approval_contribution_is_capped", score([project("one", 3)]) === score([project("one", 50)]) && trust([project("one", 50)]).scoredMilestones === 3],
    ["same_client_across_projects_remains_capped", score([project("one", 3)]) === score([project("one", 3), project("one", 40)])],
    ["extra_clean_steps_do_not_dilute_revised_approval", score(mixed(2)) === score(mixed(50))],
  ];
  return { evidenceType: "synthetic_invariant_checks_not_fraud_or_outcome_validation", passed: checks.every(([, passed]) => passed), checks: checks.map(([name, passed]) => ({ name, passed })) };
}

async function evaluateResearch(input, { development, includeAi = false, maxAiCases = 10, fetchImpl = global.fetch } = {}) {
  const dataset = validateResearchDataset(input);
  if (development) checkOverlap(dataset, development);
  if (!Number.isInteger(maxAiCases) || maxAiCases < 1 || maxAiCases > 1000) throw new Error("AI case limit must be 1–1000");
  const models = { skillOnly: [], withoutContext: [], withoutTrust: [], current: [] };
  const aiRows = [];
  let ai = { status: "not_requested", attemptedCases: 0 };
  if (includeAi) ai.status = !dataset.provenance.externalProcessingConsented ? "external_processing_not_authorized" : !aiMatchingAvailable() ? "unconfigured" : dataset.cases.length > maxAiCases ? "case_budget_exceeded" : "ready";
  for (const item of dataset.cases) {
    const applications = item.candidates.map(candidate => {
      const trust = trustFor(candidate);
      return { _id: candidate.id, freelancer: { profile: candidate.profile }, proposal: candidate.proposal, trust, historyGroup: historyGroup(candidate, trust), match: matchApplicant(item.project.requiredSkills, candidate.profile, trust, { project: item.project, proposal: candidate.proposal }), noTrust: matchApplicant(item.project.requiredSkills, candidate.profile, { score: null }, { project: item.project, proposal: candidate.proposal }) };
    });
    const selectors = { skillOnly: application => application.match.factorScores.requiredSkills, withoutContext: application => application.match.baseScore, withoutTrust: application => application.noTrust.score, current: application => application.match.score };
    for (const [name, select] of Object.entries(selectors)) {
      const ranking = applications.map(application => ({ id: application._id, score: select(application) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      models[name].push(resultRow(item, ranking, applications));
    }
    if (ai.status === "ready") {
      ai.attemptedCases++;
      try {
        const result = await rankApplicants(item.project, applications, fetchImpl);
        aiRows.push(resultRow(item, result.ranking.map(row => ({ id: row.applicationId, score: row.score })), applications));
      } catch { ai.status = "service_failed"; }
    }
  }
  if (ai.status === "ready") {
    const metrics = summary(aiRows);
    ai = { ...ai, ...metrics, metricsStatus: metrics.status, status: "completed" };
  }
  const paired = baseline => ({ currentOnlyCorrect: models.current.filter((row, index) => row.hit && !models[baseline][index].hit).length, baselineOnlyCorrect: models.current.filter((row, index) => !row.hit && models[baseline][index].hit).length, bothCorrect: models.current.filter((row, index) => row.hit && models[baseline][index].hit).length, bothIncorrect: models.current.filter((row, index) => !row.hit && !models[baseline][index].hit).length });
  const moduleHashes = Object.fromEntries(["scoring.js", "money.js", "semanticMatching.js", "matchingEvaluation.js", "researchEvaluation.js"].map(filename => [filename, hash(fs.readFileSync(path.join(__dirname, filename)))]));
  return {
    schemaVersion: 2, evidenceType: dataset.provenance.sourceType === "synthetic" ? "synthetic_pipeline_check_only" : "declared_independent_dataset",
    provenanceValidation: "declarations_and_structural_checks_not_independent_consent_verification", split: dataset.provenance.split,
    datasetHash: hash(JSON.stringify(dataset)), implementationHashes: moduleHashes,
    sampleSize: dataset.cases.length, candidateCount: dataset.cases.reduce((sum, item) => sum + item.candidates.length, 0), casesWithFewerThanThreeCandidates: dataset.cases.filter(item => item.candidates.length < 3).length,
    overlapCheck: development ? "passed_exact_case_group_and_normalized_content_checks" : "development_dataset_not_supplied",
    policy: { k: K, minimumCasesForDescriptiveRates: MIN_CASES, tieBreak: "opaque_applicant_id_lexical_as_in_regular_shortlist", uncertainty: "Wilson 95% descriptive top-one interval assumes independent cases; no significance, fairness or outcome claim" },
    methods: Object.fromEntries(Object.entries(models).map(([name, rows]) => [name, summary(rows)])),
    pairedTop1Comparisons: Object.fromEntries(["skillOnly", "withoutContext", "withoutTrust"].map(name => [name, paired(name)])),
    ai, trustAudits: trustAudits(), researchComplete: false,
    completionNote: "Tools cannot verify consent, blind labelling, source independence or real-world validity. Review the protocol and evidence before any research claim.",
  };
}

function readDataset(filename) {
  const contents = fs.readFileSync(filename);
  if (contents.length > MAX_BYTES) throw new Error("Research dataset exceeds 5 MB");
  try { return JSON.parse(contents.toString("utf8")); } catch { throw new Error("Dataset is not valid JSON"); }
}

async function runResearchCommand(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (["--ai", "--help"].includes(arg)) { if (args[arg]) throw new Error("Duplicate option"); args[arg] = true; }
    else if (["--dataset", "--development", "--report", "--ai-max-cases"].includes(arg)) {
      if (args[arg] || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Supply ${arg} once with a value`);
      args[arg] = argv[++index];
    } else throw new Error("Unsupported research option");
  }
  if (args["--help"]) return { help: "npm run eval:research -- [--dataset file.json] [--development development.json] [--report new-report.json] [--ai --ai-max-cases 10]. Without a dataset: readiness and synthetic trust audits only. AI has no automatic retries." };
  if (!args["--dataset"] && (args["--development"] || args["--ai"] || args["--ai-max-cases"])) throw new Error("Supply a dataset before requesting comparison");
  const outputPath = args["--report"] && path.resolve(args["--report"]);
  if (outputPath && [args["--dataset"], args["--development"]].filter(Boolean).some(filename => path.resolve(filename) === outputPath)) throw new Error("Report path must not replace an input dataset");
  if (outputPath && fs.existsSync(outputPath)) throw new Error("Report already exists; choose a new filename");
  const report = args["--dataset"]
    ? await evaluateResearch(readDataset(args["--dataset"]), { development: args["--development"] ? readDataset(args["--development"]) : undefined, includeAi: Boolean(args["--ai"]), maxAiCases: args["--ai-max-cases"] ? Number(args["--ai-max-cases"]) : 10 })
    : { schemaVersion: 2, status: "awaiting_independent_dataset", realCasesEvaluated: 0, ai: { status: "not_requested", attemptedCases: 0 }, trustAudits: trustAudits(), researchComplete: false };
  if (outputPath) { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); }
  return report;
}

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
  runResearchCommand().then(report => console.log(JSON.stringify(report, null, 2))).catch(error => { console.error(error.code ? `Research file operation failed (${error.code}); check file paths and permissions.` : `Research evaluation failed: ${error.message}`); process.exitCode = 1; });
}
module.exports = { validateResearchDataset, checkOverlap, wilsonInterval, rankingMetrics, aggregate, trustAudits, evaluateResearch, runResearchCommand };
