const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateResearchDataset, checkOverlap, rankingMetrics, aggregate, wilsonInterval, evaluateResearch, trustAudits, runResearchCommand } = require("./researchEvaluation");
const { cases: legacyCases } = require("./matchingEvaluation");

function fixture(count = 6) {
  return {
    schemaVersion: 2,
    provenance: { sourceType: "synthetic", datasetToken: "dataset-smoke01", consented: false, anonymized: true, independentLabels: false, scoresHiddenDuringLabelling: false, reviewerCount: 0, holdoutUnusedForTuning: false, split: "holdout", externalProcessingConsented: false },
    cases: Array.from({ length: count }, (_, index) => ({
      caseId: `case-${String(index).padStart(2, "0")}`, groupToken: `group-${String(index).padStart(2, "0")}`,
      project: { category: "Web Development", title: `Interface ${index}`, description: `Implement a responsive analytics interface for department ${index}, with captions and account screens.`, requiredSkills: ["React"] },
      candidates: [
        { id: "candidate-aa", experienceGroup: "experienced", profile: { skills: ["React"], experienceYears: 3, headline: "Analytics interface builder", bio: "Responsive analytics interface, captions and account screens." }, proposal: "I will implement the requested interface.", history: { recordedBeforeCase: true, projects: [] } },
        { id: "candidate-bb", experienceGroup: "experienced", profile: { skills: ["Writing"], experienceYears: 5, headline: "Writer", bio: "Editorial copy and proofreading." }, proposal: "I can deliver editorial content.", history: { recordedBeforeCase: true, projects: [{ clientToken: "client-aa", status: "Completed", milestones: [{ status: "completed", revisionCount: 0 }] }] } },
        { id: "candidate-cc", profile: { skills: ["Excel"], experienceYears: 1, bio: "Spreadsheet tables." }, proposal: "I can organise a spreadsheet." },
      ], relevantApplicantIds: ["candidate-aa"],
    })),
  };
}

test("synthetic fixtures cannot become independently consented research by changing only sourceType", () => {
  const data = fixture();
  assert.equal(validateResearchDataset(data), data);
  data.provenance.sourceType = "independent_consented";
  assert.throws(() => validateResearchDataset(data), /Real research data/);
  Object.assign(data.provenance, { consented: true, independentLabels: true, scoresHiddenDuringLabelling: true, reviewerCount: 2, holdoutUnusedForTuning: true });
  assert.equal(validateResearchDataset(data), data); // tests declarations, not actual consent
  data.cases[0].project = legacyCases[0].project;
  assert.throws(() => validateResearchDataset(data), /Legacy tuned/);
});

test("unknown fields, personal text, unsafe histories and blank collection templates are rejected", () => {
  for (const mutate of [
    data => { data.cases[0].candidates[0].email = "person@example.test"; },
    data => { data.cases[0].candidates[0].proposal += " contact person@example.test"; },
    data => { data.cases[0].candidates[0].history.projects = [{ clientToken: "client-aa", status: "Completed", milestones: [{ status: "completed", revisionCount: -1 }] }]; },
    data => { data.cases[0].candidates[0].history.recordedBeforeCase = false; },
    data => { data.cases[0].candidates[0].history.rating = 5; },
    data => { data.cases = []; },
  ]) { const data = fixture(); mutate(data); assert.throws(() => validateResearchDataset(data)); }
});

test("duplicates and exact development/holdout leakage are rejected despite changed labels or titles", () => {
  const repeated = fixture();
  repeated.cases[1].project = { ...repeated.cases[0].project, title: "Renamed project" };
  assert.throws(() => validateResearchDataset(repeated), /Repeated project/);
  const groups = fixture(); groups.cases[1].groupToken = groups.cases[0].groupToken;
  assert.throws(() => validateResearchDataset(groups), /independent project group/);
  const development = fixture(); development.provenance.split = "development";
  assert.throws(() => checkOverlap(fixture(), development), /overlaps/);
  for (const item of development.cases) { item.caseId += "dev"; item.groupToken += "dev"; item.project.description += " Separate development source."; }
  assert.doesNotThrow(() => checkOverlap(fixture(), development));
});

test("ranking metrics handle multiple relevant applicants and expose ID-based ties", () => {
  const row = rankingMetrics([{ id: "a", score: 90 }, { id: "b", score: 90 }, { id: "c", score: 10 }, { id: "d", score: 0 }], ["b", "d"]);
  assert.equal(row.hit, false); assert.equal(row.reciprocalRank, 0.5); assert.equal(row.recallAt3, 0.5);
  assert.ok(Math.abs(row.ndcgAt3 - (1 / Math.log2(3)) / (1 + 1 / Math.log2(3))) < 1e-12);
  assert.equal(row.tiedTop, true); assert.equal(row.tieNeutralHit, 0.5);
  const tiny = aggregate([row]);
  assert.equal(tiny.status, "insufficient_data"); assert.equal(tiny.top1HitRate, null); assert.equal(tiny.top1Wilson95Percent, null);
  assert.deepEqual(wilsonInterval(5, 10), [23.66, 76.34]);
  assert.deepEqual(wilsonInterval(0, 0), null);
});

test("offline report compares baselines and separates new platform history from experience", async () => {
  let calls = 0;
  const report = await evaluateResearch(fixture(), { fetchImpl: async () => { calls++; throw new Error("Unexpected network"); } });
  assert.equal(calls, 0); assert.equal(report.evidenceType, "synthetic_pipeline_check_only"); assert.equal(report.researchComplete, false);
  assert.deepEqual(Object.keys(report.methods), ["skillOnly", "withoutContext", "withoutTrust", "current"]);
  assert.equal(report.methods.current.byRelevantPlatformHistory[0].group, "no_approved_platform_history");
  assert.equal(report.methods.current.byRelevantExperience[0].group, "experienced");
  assert.equal(report.methods.current.sampleSize, 6); assert.equal(report.candidateCount, 18);
  assert.equal(report.pairedTop1Comparisons.skillOnly.bothCorrect, 6);
  assert.equal(report.implementationHashes["scoring.js"].length, 64);
  const output = JSON.stringify(report);
  assert.doesNotMatch(output, /candidate-aa|case-00|department|Editorial copy|client-aa/);
});

test("missing history snapshots stay distinct from verified cold-start history", async () => {
  const data = fixture(); delete data.cases[0].candidates[0].history;
  const report = await evaluateResearch(data);
  const group = report.methods.current.byRelevantPlatformHistory.find(row => row.group === "missing_history_snapshot");
  assert.equal(group.sampleSize, 1); assert.equal(group.status, "insufficient_data");
});

test("experience-group rubric is enforced and missing subgroup labels suppress rates", async () => {
  const bad = fixture(); bad.cases[0].candidates[0].experienceGroup = "new";
  assert.throws(() => validateResearchDataset(bad), /Experience group/);
  const data = fixture();
  for (const item of data.cases) delete item.candidates[0].experienceGroup;
  const report = await evaluateResearch(data);
  assert.equal(report.methods.current.byRelevantExperience[0].status, "incomplete_group_labels");
  assert.equal(report.methods.current.byRelevantExperience[0].top1HitRate, null);
});

test("trust ablation uses recorded prior platform evidence without modifying live scoring", async () => {
  const data = fixture(1);
  const a = data.cases[0].candidates[0];
  const b = data.cases[0].candidates[1];
  b.profile = structuredClone(a.profile); b.proposal = a.proposal;
  a.history.projects = [{ clientToken: "client-aa", status: "Completed", milestones: Array.from({ length: 3 }, () => ({ status: "completed", revisionCount: 5 })) }];
  b.history.projects = Array.from({ length: 4 }, (_, index) => ({ clientToken: `client-0${index}`, status: "Completed", milestones: Array.from({ length: 3 }, () => ({ status: "completed", revisionCount: 0 })) }));
  data.cases[0].relevantApplicantIds = ["candidate-bb"];
  const report = await evaluateResearch(data);
  assert.equal(report.methods.current.correctTop1, 1);
  assert.equal(report.methods.withoutTrust.correctTop1, 0);
  assert.equal(report.pairedTop1Comparisons.withoutTrust.currentOnlyCorrect, 1);
  assert.equal(trustAudits().passed, true); assert.equal(trustAudits().checks.length, 6);
});

test("external-processing consent, explicit AI selection, key and case budget all gate network calls", async () => {
  const prior = process.env.OPENAI_API_KEY;
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("Should not call"); };
  try {
    const data = fixture();
    process.env.OPENAI_API_KEY = "test-only-key";
    assert.equal((await evaluateResearch(data, { includeAi: true, fetchImpl })).ai.status, "external_processing_not_authorized");
    data.provenance.externalProcessingConsented = true;
    assert.equal((await evaluateResearch(data, { includeAi: true, maxAiCases: 1, fetchImpl })).ai.status, "case_budget_exceeded");
    delete process.env.OPENAI_API_KEY;
    assert.equal((await evaluateResearch(data, { includeAi: true, fetchImpl })).ai.status, "unconfigured");
    assert.equal(calls, 0);
  } finally { if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior; }
});

test("AI failure preserves the offline report and stops further paid requests without partial metrics", async () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  let calls = 0;
  const data = fixture(); data.provenance.externalProcessingConsented = true;
  try {
    const report = await evaluateResearch(data, { includeAi: true, fetchImpl: async () => { calls++; return { ok: false, status: 503 }; } });
    assert.equal(calls, 1); assert.equal(report.ai.status, "service_failed"); assert.equal(report.ai.top1HitRate, undefined);
    assert.equal(report.methods.current.sampleSize, 6);
  } finally { if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior; }
});

test("all-cases successful mocked AI comparison emits only aggregate metrics", async () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  const data = fixture(); data.provenance.externalProcessingConsented = true;
  let calls = 0;
  try {
    const report = await evaluateResearch(data, { includeAi: true, fetchImpl: async (_url, options) => {
      calls++; const texts = JSON.parse(options.body).input;
      return { ok: true, json: async () => ({ data: texts.map((_, index) => ({ index, embedding: index < 2 ? [1, 0] : [0, 1] })) }) };
    } });
    assert.equal(calls, 6); assert.equal(report.ai.status, "completed"); assert.equal(report.ai.correctTop1, 6);
    assert.doesNotMatch(JSON.stringify(report.ai), /candidate-aa|interface builder/);
  } finally { if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior; }
});

test("CLI emits readiness without data and will not overwrite dataset or existing report", async () => {
  const report = await runResearchCommand([]);
  assert.equal(report.status, "awaiting_independent_dataset"); assert.equal(report.realCasesEvaluated, 0);
  await assert.rejects(() => runResearchCommand(["--ai"]), /Supply a dataset/);
  await assert.rejects(() => runResearchCommand(["--dataset"]));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "freelancechain-research-"));
  const input = path.join(directory, "dataset.json");
  const output = path.join(directory, "report.json");
  fs.writeFileSync(input, JSON.stringify(fixture()));
  try {
    await assert.rejects(() => runResearchCommand(["--dataset", input, "--report", input]), /must not replace/);
    await runResearchCommand(["--dataset", input, "--report", output]);
    await assert.rejects(() => runResearchCommand(["--dataset", input, "--report", output]), /already exists/);
    assert.equal(JSON.parse(fs.readFileSync(output)).evidenceType, "synthetic_pipeline_check_only");
    assert.equal(JSON.parse(fs.readFileSync(input)).cases.length, 6);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
