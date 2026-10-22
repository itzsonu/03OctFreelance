const fs = require("node:fs");
const path = require("node:path");
const { matchApplicant } = require("./scoring");
const { rankApplicants, aiMatchingAvailable } = require("./semanticMatching");

const MIN_REPORTED_SAMPLE_SIZE = 5;
const MAX_DATASET_BYTES = 5 * 1024 * 1024;
const MAX_DATASET_CASES = 1000;
const MAX_CANDIDATES_PER_CASE = 20;
const projectCategories = new Set([
  "Web Development", "Design & Creative", "Writing & Translation", "Marketing",
  "Data & Analytics", "Video & Animation", "Admin & Support", "Other",
]);
const allowedRootKeys = new Set(["schemaVersion", "consented", "anonymized", "cases"]);
const allowedCaseKeys = new Set(["caseId", "project", "candidates", "relevantApplicantIds"]);
const allowedProjectKeys = new Set(["category", "title", "description", "requiredSkills"]);
const allowedCandidateKeys = new Set(["id", "experienceGroup", "profile", "proposal"]);
const allowedProfileKeys = new Set(["skills", "experienceYears", "headline", "bio"]);
const sensitiveKeyPattern = /(^|[_-])(name|full.?name|first.?name|last.?name|email|phone|telephone|mobile|address|street|postal.?code|zip|ssn|social.?security|birth.?date|date.?of.?birth|dob|username|handle|linkedin|url|website)([_-]|$)/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const urlPattern = /\b(?:https?:\/\/|www\.)\S+/i;
const phonePattern = /(?:\+?\d[\d ().-]{8,}\d)/;
const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
const socialHandlePattern = /(?<!\w)@[a-z0-9_.]{2,}/i;
const addressPattern = /\b\d{1,6}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}\s+(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Lane|Ln\.?|Drive|Dr\.?)\b/i;
const contactNamePattern = /\b(?:my name is|contact me as|reach me at|email me)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/i;
const anonymizedCaseIdPattern = /^case[-_][a-z0-9]{2,32}$/i;
const anonymizedCandidateIdPattern = /^(?:candidate|cand)[-_][a-z0-9]{2,32}$/i;

// Fictional examples check the evaluation pipeline. They are not real hiring labels.
const cases = [
  {
    name: "Dashboard framework wording", relevantId: "a",
    project: { title: "React dashboard", description: "Build an accessible React dashboard with charts and account views.", requiredSkills: ["React"] },
    candidates: [
      { id: "a", profile: { skills: ["ReactJS"], experienceYears: 3, bio: "Built accessible analytics dashboards." }, proposal: "I will build the dashboard and chart views." },
      { id: "b", profile: { skills: ["React"], experienceYears: 1, bio: "I make simple landing pages." }, proposal: "I can make a landing page." },
    ],
  },
  {
    name: "Mobile research context", relevantId: "a",
    project: { title: "Mobile UX study", description: "Research the mobile checkout journey and design testable Figma flows.", requiredSkills: ["Figma"] },
    candidates: [
      { id: "a", profile: { skills: ["Figma"], experienceYears: 2, bio: "Mobile usability studies and checkout prototypes." }, proposal: "I will test checkout flows with users." },
      { id: "b", profile: { skills: ["Figma"], experienceYears: 6, bio: "I create brand logos and social graphics." }, proposal: "I can design a new logo." },
    ],
  },
  {
    name: "Backend API fit", relevantId: "a",
    project: { title: "Node API", description: "Build a Node.js API for account records and secure data retrieval.", requiredSkills: ["Node.js"] },
    candidates: [
      { id: "a", profile: { skills: ["Node.js"], experienceYears: 3, bio: "Express APIs and MongoDB data models." }, proposal: "I will deliver tested endpoints." },
      { id: "b", profile: { skills: ["Copywriting"], experienceYears: 5, bio: "Editorial content for websites." }, proposal: "I can write documentation." },
    ],
  },
  {
    name: "Editorial writing fit", relevantId: "a",
    project: { title: "Research articles", description: "Write researched articles with an editorial review cycle.", requiredSkills: ["Copywriting"] },
    candidates: [
      { id: "a", profile: { skills: ["Copywriting"], experienceYears: 2, bio: "Long-form articles and editing." }, proposal: "I will deliver sourced drafts." },
      { id: "b", profile: { skills: ["React"], experienceYears: 5, bio: "Frontend development." }, proposal: "I can make a website." },
    ],
  },
  {
    name: "Database migration experience", relevantId: "b",
    project: { title: "Database migration", description: "Migrate production records into MongoDB with validation.", requiredSkills: ["MongoDB"] },
    candidates: [
      { id: "a", profile: { skills: ["MongoDB"], experienceYears: 1, bio: "Personal database projects." }, proposal: "I can try the migration." },
      { id: "b", profile: { skills: ["MongoDB"], experienceYears: 5, bio: "Production database migrations and validation." }, proposal: "I will test data integrity." },
    ],
  },
  {
    name: "Full stack coverage", relevantId: "a",
    project: { title: "Client portal", description: "Build a React portal and Node.js API for clients.", requiredSkills: ["React", "Node.js"] },
    candidates: [
      { id: "a", profile: { skills: ["React", "Node.js"], experienceYears: 2, bio: "Full stack client portals." }, proposal: "I will connect the UI and API." },
      { id: "b", profile: { skills: ["React"], experienceYears: 5, bio: "Static landing pages." }, proposal: "I can build the UI only." },
    ],
  },
];

const holdoutCases = [
  {
    name: "Nonprofit grant narrative context", relevantId: "a",
    project: { title: "Community health grant narrative", description: "Write a grant application for a community health program, connecting measurable outcomes to the funder's criteria.", requiredSkills: ["Grant Writing"] },
    candidates: [
      { id: "a", profile: { skills: ["Grant Writing"], experienceYears: 1, headline: "Nonprofit grant writer", bio: "Community health grants, outcome measures, and funder requirements." }, proposal: "I will map the program outcomes to the criteria and draft a sourced narrative." },
      { id: "b", profile: { skills: ["Grant Writing"], experienceYears: 8, headline: "Senior marketing writer", bio: "Retail campaigns, brand launches, and promotional copy." }, proposal: "I can write an engaging grant application." },
    ],
  },
  {
    name: "Healthcare explainer video keyword match", relevantId: "a",
    project: { title: "Patient instruction explainer animation", description: "Create a short 2D animated explainer for pediatric patients, with clear medication steps and accessible captions.", requiredSkills: ["After Effects"] },
    candidates: [
      { id: "a", profile: { skills: ["After Effects"], experienceYears: 2, headline: "Healthcare motion designer", bio: "Patient education animations, medication instructions, and captioned explainers." }, proposal: "I will storyboard the medication steps and deliver captioned 2D animation." },
      { id: "b", profile: { skills: ["After Effects"], experienceYears: 7, headline: "Commercial video editor", bio: "Restaurant ads, product reels, and event recaps." }, proposal: "Pediatric patients, medication instructions, accessible captions, and 2D explainer animation are all keywords in your brief; I edit commercial videos." },
    ],
  },
  {
    name: "Survey analysis with new freelancer", relevantId: "a",
    project: { title: "Survey nonresponse analysis", description: "Analyze survey response data for nonresponse bias and summarize the findings for a policy team.", requiredSkills: ["R"] },
    candidates: [
      { id: "a", profile: { skills: ["R"], experienceYears: 1, headline: "Survey research analyst", bio: "Sampling, response rates, nonresponse bias, and policy reporting." }, proposal: "I will compare respondent groups, document limitations, and summarize the findings." },
      { id: "b", profile: { skills: ["R"], experienceYears: 8, headline: "R package developer", bio: "Package maintenance, build tooling, and performance profiling." }, proposal: "I can build an R package to process the survey file." },
    ],
  },
  {
    name: "Operations scheduling without platform history", relevantId: "a",
    project: { title: "Field service route schedule", description: "Organize technician visits by travel time, appointment windows, and urgent repair priority.", requiredSkills: ["Excel"] },
    candidates: [
      { id: "a", profile: { skills: ["Excel"], experienceYears: 2, headline: "Field operations coordinator", bio: "Technician dispatch, route planning, appointment windows, and urgent repairs." }, proposal: "I will group visits by travel time and flag schedule conflicts." },
      { id: "b", profile: { skills: ["Excel"], experienceYears: 9, headline: "Financial reporting analyst", bio: "Monthly close, spreadsheet dashboards, and budget variance reports." }, proposal: "I can build an Excel dashboard for the schedule." },
    ],
  },
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (sensitiveKeyPattern.test(key)) throw new Error(`Input contains a prohibited personal identifier field at ${label}`);
    if (!allowed.has(key)) throw new Error(`Unsupported evaluation field at ${label}`);
  }
}

function assertText(value, label, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw new Error(`Invalid text value at ${label}`);
  }
  if (emailPattern.test(value) || urlPattern.test(value) || phonePattern.test(value) || ssnPattern.test(value) || socialHandlePattern.test(value) || addressPattern.test(value) || contactNamePattern.test(value)) {
    throw new Error(`Input contains an obvious personal identifier at ${label}`);
  }
  return value;
}

function assertStringArray(value, label, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`Invalid list at ${label}`);
  value.forEach((item, index) => assertText(item, `${label}[${index}]`, maxLength));
}

function validateDataset(dataset) {
  if (!isRecord(dataset)) throw new Error("Evaluation dataset must be a JSON object");
  assertOnlyKeys(dataset, allowedRootKeys, "dataset root");
  if (dataset.schemaVersion !== 1) throw new Error("Evaluation dataset schemaVersion must be 1");
  if (dataset.consented !== true) throw new Error("Dataset must be explicitly marked consented");
  if (dataset.anonymized !== true) throw new Error("Dataset must be explicitly marked anonymized");
  if (!Array.isArray(dataset.cases) || dataset.cases.length < 1 || dataset.cases.length > MAX_DATASET_CASES) {
    throw new Error(`Dataset must contain 1-${MAX_DATASET_CASES} labeled cases`);
  }

  const caseIds = new Set();
  let applicantCount = 0;
  for (const [caseIndex, item] of dataset.cases.entries()) {
    const caseLabel = `cases[${caseIndex}]`;
    if (!isRecord(item)) throw new Error(`Invalid case at ${caseLabel}`);
    assertOnlyKeys(item, allowedCaseKeys, caseLabel);
    assertText(item.caseId, `${caseLabel}.caseId`, 40);
    if (!anonymizedCaseIdPattern.test(item.caseId)) throw new Error(`Case ID must be an opaque anonymized token at ${caseLabel}`);
    if (caseIds.has(item.caseId)) throw new Error(`Duplicate case ID at ${caseLabel}`);
    caseIds.add(item.caseId);

    const project = item.project;
    if (!isRecord(project)) throw new Error(`Invalid project at ${caseLabel}`);
    assertOnlyKeys(project, allowedProjectKeys, `${caseLabel}.project`);
    if (project.category !== undefined && !projectCategories.has(project.category)) throw new Error(`Unsupported project category at ${caseLabel}.project.category`);
    assertText(project.title, `${caseLabel}.project.title`, 200);
    assertText(project.description, `${caseLabel}.project.description`, 4000);
    assertStringArray(project.requiredSkills, `${caseLabel}.project.requiredSkills`, 30, 80);

    if (!Array.isArray(item.candidates) || item.candidates.length < 2 || item.candidates.length > MAX_CANDIDATES_PER_CASE) {
      throw new Error(`Each case must contain 2-${MAX_CANDIDATES_PER_CASE} applicants at ${caseLabel}`);
    }
    const candidateIds = new Set();
    for (const [candidateIndex, candidate] of item.candidates.entries()) {
      const candidateLabel = `${caseLabel}.candidates[${candidateIndex}]`;
      if (!isRecord(candidate)) throw new Error(`Invalid applicant at ${candidateLabel}`);
      assertOnlyKeys(candidate, allowedCandidateKeys, candidateLabel);
      assertText(candidate.id, `${candidateLabel}.id`, 40);
      if (!anonymizedCandidateIdPattern.test(candidate.id)) throw new Error(`Applicant ID must be an opaque anonymized token at ${candidateLabel}`);
      if (candidateIds.has(candidate.id)) throw new Error(`Duplicate applicant ID at ${candidateLabel}`);
      candidateIds.add(candidate.id);
      if (candidate.experienceGroup !== undefined && !["new", "experienced"].includes(candidate.experienceGroup)) {
        throw new Error(`experienceGroup must be new or experienced at ${candidateLabel}`);
      }
      if (!isRecord(candidate.profile)) throw new Error(`Invalid profile at ${candidateLabel}`);
      assertOnlyKeys(candidate.profile, allowedProfileKeys, `${candidateLabel}.profile`);
      assertStringArray(candidate.profile.skills, `${candidateLabel}.profile.skills`, 30, 80);
      if (!Number.isInteger(candidate.profile.experienceYears) || candidate.profile.experienceYears < 0 || candidate.profile.experienceYears > 60) {
        throw new Error(`Invalid experienceYears at ${candidateLabel}.profile`);
      }
      if (candidate.profile.headline !== undefined) assertText(candidate.profile.headline, `${candidateLabel}.profile.headline`, 120, { allowEmpty: true });
      if (candidate.profile.bio !== undefined) assertText(candidate.profile.bio, `${candidateLabel}.profile.bio`, 2000, { allowEmpty: true });
      assertText(candidate.proposal, `${candidateLabel}.proposal`, 2000);
    }
    applicantCount += item.candidates.length;
    if (!Array.isArray(item.relevantApplicantIds) || !item.relevantApplicantIds.length || item.relevantApplicantIds.length > item.candidates.length) {
      throw new Error(`Each case requires at least one relevant applicant label at ${caseLabel}`);
    }
    if (new Set(item.relevantApplicantIds).size !== item.relevantApplicantIds.length || item.relevantApplicantIds.some(id => !candidateIds.has(id))) {
      throw new Error(`Relevant applicant labels must reference unique applicants at ${caseLabel}`);
    }
  }
  if (applicantCount > MAX_DATASET_CASES * MAX_CANDIDATES_PER_CASE) throw new Error("Dataset contains too many applicants");
  return dataset;
}

function makeCaseResult(item, topApplicantId) {
  const relevantIds = new Set(item.relevantApplicantIds);
  const relevantApplicants = item.candidates.filter(candidate => relevantIds.has(candidate.id));
  const experienceGroups = new Set(relevantApplicants.map(candidate => candidate.experienceGroup).filter(Boolean));
  const hasAllExperienceLabels = relevantApplicants.every(candidate => Boolean(candidate.experienceGroup));
  const experienceGroup = hasAllExperienceLabels && experienceGroups.size === 1
    ? [...experienceGroups][0]
    : "missing or mixed label";
  return {
    category: item.project.category || "missing category label",
    hasCategoryLabel: Boolean(item.project.category),
    experienceGroup,
    hasExperienceLabel: experienceGroup !== "missing or mixed label",
    topRankedRelevant: relevantIds.has(topApplicantId),
  };
}

function aggregateMetrics(rows, hasLabel = true) {
  const topRankedRelevantApplicantCount = rows.filter(row => row.topRankedRelevant).length;
  const sampleSize = rows.length;
  const top1AccuracyPercent = !hasLabel || sampleSize < MIN_REPORTED_SAMPLE_SIZE
    ? "insufficient data"
    : Math.round(topRankedRelevantApplicantCount / sampleSize * 1000) / 10;
  return { sampleSize, topRankedRelevantApplicantCount, top1AccuracyPercent };
}

function splitMetrics(rows, key, labelKey) {
  const groups = new Map();
  for (const row of rows) {
    const group = row[key];
    const values = groups.get(group) || [];
    values.push(row);
    groups.set(group, values);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([group, values]) => ({
    group,
    ...aggregateMetrics(values, values.every(row => row[labelKey])),
  }));
}

function unavailableAi(reason) {
  return { status: "unavailable", reason };
}

async function evaluateDataset(input, { includeAi = false, fetchImpl = fetch } = {}) {
  const dataset = validateDataset(input);
  const evaluated = [];
  const aiEvaluated = [];
  for (const item of dataset.cases) {
    const applications = item.candidates.map(candidate => ({
      _id: candidate.id,
      freelancer: { profile: candidate.profile },
      proposal: candidate.proposal,
      trust: { score: null, approvedMilestones: 0, revisionRequests: 0, scoredMilestones: 0, clientCount: 0 },
      match: matchApplicant(item.project.requiredSkills, candidate.profile, { score: null }, { project: item.project, proposal: candidate.proposal }),
    }));
    const ruleWinner = [...applications].sort((left, right) => right.match.score - left.match.score || String(left._id).localeCompare(String(right._id)))[0];
    evaluated.push(makeCaseResult(item, String(ruleWinner._id)));

    if (includeAi && aiMatchingAvailable()) {
      const result = await rankApplicants(item.project, applications, fetchImpl);
      aiEvaluated.push(makeCaseResult(item, result.ranking[0].applicationId));
    }
  }

  const report = {
    source: "consented_anonymized_json_dataset",
    method: "rule_based_offline",
    sampleSize: evaluated.length,
    ...aggregateMetrics(evaluated),
    byProjectCategory: splitMetrics(evaluated, "category", "hasCategoryLabel"),
    byRelevantExperienceGroup: splitMetrics(evaluated, "experienceGroup", "hasExperienceLabel"),
    ai: !includeAi
      ? unavailableAi("Not requested. Pass --ai to explicitly enable the optional OpenAI comparison.")
      : !aiMatchingAvailable()
        ? unavailableAi("OPENAI_API_KEY is not configured locally.")
        : {
          status: "available",
          method: "embedding_cosine_v1",
          sampleSize: aiEvaluated.length,
          ...aggregateMetrics(aiEvaluated),
          byProjectCategory: splitMetrics(aiEvaluated, "category", "hasCategoryLabel"),
          byRelevantExperienceGroup: splitMetrics(aiEvaluated, "experienceGroup", "hasExperienceLabel"),
        },
  };
  return report;
}

function prepared(item) {
  return item.candidates.map(candidate => ({
    _id: candidate.id,
    freelancer: { profile: candidate.profile },
    proposal: candidate.proposal,
    trust: candidate.trust || { score: null, approvedMilestones: 0, revisionRequests: 0, scoredMilestones: 0, clientCount: 0 },
    match: matchApplicant(item.project.requiredSkills, candidate.profile, candidate.trust || { score: null }, { project: item.project, proposal: candidate.proposal }),
  }));
}

function summarize(results) {
  return { correctTop1: results.filter(result => result.correct).length, total: results.length, cases: results };
}

function evaluateSet(dataset, scoreKey = "score") {
  return summarize(dataset.map(item => {
    const applications = prepared(item);
    const score = application => application.match[scoreKey];
    const winner = [...applications].sort((a, b) => score(b) - score(a) || a._id.localeCompare(b._id))[0];
    return {
      name: item.name,
      correct: winner._id === item.relevantId,
      topId: winner._id,
      topScore: score(winner),
      scores: applications.map(application => ({ id: application._id, score: score(application) })),
      factors: applications.map(application => ({
        id: application._id,
        baseScore: application.match.baseScore,
        contextScore: application.match.contextScore,
        contextProfileScore: application.match.contextProfileScore,
        contextProposalScore: application.match.contextProposalScore,
      })),
    };
  }));
}

async function evaluate(includeAi = false, fetchImpl = fetch) {
  const datasets = { diagnostic: cases, holdout: holdoutCases };
  const baseline = Object.fromEntries(Object.entries(datasets).map(([name, dataset]) => [name, evaluateSet(dataset, "baseScore")]));
  const current = Object.fromEntries(Object.entries(datasets).map(([name, dataset]) => [name, evaluateSet(dataset)]));
  if (!includeAi) return { dataset: "fictional diagnostic and holdout cases; not real-world accuracy", baseline, current, ai: unavailableAi("Not requested. Pass --ai to explicitly enable the optional OpenAI comparison.") };
  if (!aiMatchingAvailable()) return { dataset: "fictional diagnostic and holdout cases; not real-world accuracy", baseline, current, ai: unavailableAi("OPENAI_API_KEY is not configured locally.") };
  const evaluateAiSet = dataset => Promise.all(dataset.map(async item => {
    const result = await rankApplicants(item.project, prepared(item), fetchImpl);
    return { name: item.name, correct: result.ranking[0].applicationId === item.relevantId, topId: result.ranking[0].applicationId, topScore: result.ranking[0].score };
  }));
  try {
    const ai = { status: "available", diagnostic: summarize(await evaluateAiSet(cases)), holdout: summarize(await evaluateAiSet(holdoutCases)) };
    return { dataset: "fictional diagnostic and holdout cases; not real-world accuracy", baseline, current, ai };
  } catch {
    return { dataset: "fictional diagnostic and holdout cases; not real-world accuracy", baseline, current, ai: unavailableAi("OpenAI comparison failed; no AI results are reported.") };
  }
}

function parseCommandArguments(argv) {
  const parsed = { datasetPath: null, includeAi: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ai") parsed.includeAi = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--dataset") {
      if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error("--dataset requires a JSON file path");
      if (parsed.datasetPath) throw new Error("Specify --dataset only once");
      parsed.datasetPath = argv[index + 1];
      index += 1;
    } else throw new Error(`Unknown evaluation option: ${arg}`);
  }
  return parsed;
}

const HELP = "Usage: node backend/matchingEvaluation.js [--dataset <consented-anonymized.json>] [--ai]\nWithout --dataset, runs the fictional diagnostic/holdout examples. OpenAI comparison is only attempted with explicit --ai and a locally configured OPENAI_API_KEY.";

async function runEvaluationCommand(argv = process.argv.slice(2), options = {}) {
  const args = parseCommandArguments(argv);
  if (args.help) {
    (options.writeOutput || console.log)(HELP);
    return { help: HELP };
  }

  let report;
  if (!args.datasetPath) {
    report = await evaluate(args.includeAi, options.fetchImpl || fetch);
  } else {
    const filename = path.resolve(options.cwd || process.cwd(), args.datasetPath);
    const readFile = options.readFile || fs.readFileSync;
    const fileContents = readFile(filename, "utf8");
    const text = Buffer.isBuffer(fileContents) ? fileContents.toString("utf8") : String(fileContents);
    if (Buffer.byteLength(text, "utf8") > MAX_DATASET_BYTES) throw new Error(`Evaluation dataset exceeds ${MAX_DATASET_BYTES} bytes`);
    let dataset;
    try { dataset = JSON.parse(text); } catch { throw new Error("Evaluation dataset is not valid JSON"); }
    report = await evaluateDataset(dataset, { includeAi: args.includeAi, fetchImpl: options.fetchImpl || fetch });
  }
  (options.writeOutput || console.log)(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  require("dotenv").config({ path: path.resolve(__dirname, ".env") });
  runEvaluationCommand().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { cases, holdoutCases, validateDataset, evaluateDataset, parseCommandArguments, runEvaluationCommand, evaluate };
