const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateDataset, evaluateDataset, runEvaluationCommand } = require("./matchingEvaluation");

function datasetWithCases(count, options = {}) {
  return {
    schemaVersion: 1,
    consented: true,
    anonymized: true,
    cases: Array.from({ length: count }, (_, index) => ({
      caseId: `case-${String(index + 1).padStart(2, "0")}`,
      project: {
        ...(options.missingCategory ? {} : { category: index % 2 ? "Design & Creative" : "Web Development" }),
        title: "Build a product dashboard",
        description: "Create a responsive interface and clear implementation handoff.",
        requiredSkills: ["React"],
      },
      candidates: [
        {
          id: "candidate-a001",
          ...(options.missingExperience ? {} : { experienceGroup: index % 2 ? "experienced" : "new" }),
          profile: { skills: ["React"], experienceYears: 4, headline: "Frontend developer", bio: "Responsive product interfaces." },
          proposal: "I will implement the dashboard and document the handoff.",
        },
        {
          id: "candidate-b002",
          experienceGroup: "experienced",
          profile: { skills: [], experienceYears: 0, headline: "Junior writer", bio: "Editorial support." },
          proposal: "I will prepare the copy.",
        },
      ],
      relevantApplicantIds: [index % 2 ? "candidate-b002" : "candidate-a001"],
    })),
  };
}

test("validates consented anonymized dataset structure", () => {
  assert.equal(validateDataset(datasetWithCases(1)).cases.length, 1);
  assert.throws(() => validateDataset({ ...datasetWithCases(1), consented: false }), /consented/i);
  assert.throws(() => validateDataset({ ...datasetWithCases(1), anonymized: false }), /anonymized/i);
});

test("rejects personal-identifier fields and obvious personal data in text", () => {
  const named = datasetWithCases(1);
  named.cases[0].candidates[0].profile.fullName = "A Person";
  assert.throws(() => validateDataset(named), /personal identifier/i);

  const emailed = datasetWithCases(1);
  emailed.cases[0].candidates[0].proposal += " Contact me at person@example.test.";
  assert.throws(() => validateDataset(emailed), /personal identifier/i);

  const linked = datasetWithCases(1);
  linked.cases[0].project.description += " See https://example.test/profile.";
  assert.throws(() => validateDataset(linked), /personal identifier/i);

  const phone = datasetWithCases(1);
  phone.cases[0].candidates[0].proposal += " Call +1 (555) 123-4567.";
  assert.throws(() => validateDataset(phone), /personal identifier/i);

  const handle = datasetWithCases(1);
  handle.cases[0].candidates[0].profile.bio += " @private_handle";
  assert.throws(() => validateDataset(handle), /personal identifier/i);
});

test("reports top-ranked relevant count and category/experience splits", async () => {
  const report = await evaluateDataset(datasetWithCases(10));
  assert.equal(report.sampleSize, 10);
  assert.equal(report.topRankedRelevantApplicantCount, 5);
  assert.equal(report.top1AccuracyPercent, 50);
  assert.deepEqual(report.byProjectCategory.map(group => group.sampleSize), [5, 5]);
  assert.deepEqual(report.byProjectCategory.map(group => group.topRankedRelevantApplicantCount), [0, 5]);
  assert.deepEqual(report.byRelevantExperienceGroup.map(group => group.group), ["experienced", "new"]);
  assert.deepEqual(report.byRelevantExperienceGroup.map(group => group.sampleSize), [5, 5]);
});

test("tiny samples and missing labels report insufficient data, not zero accuracy", async () => {
  const tiny = await evaluateDataset(datasetWithCases(2));
  assert.equal(tiny.sampleSize, 2);
  assert.equal(tiny.top1AccuracyPercent, "insufficient data");
  assert.ok(tiny.byProjectCategory.every(group => group.top1AccuracyPercent === "insufficient data"));

  const missing = await evaluateDataset(datasetWithCases(6, { missingCategory: true, missingExperience: true }));
  assert.equal(missing.byProjectCategory[0].group, "missing category label");
  assert.equal(missing.byProjectCategory[0].top1AccuracyPercent, "insufficient data");
  const missingExperienceGroup = missing.byRelevantExperienceGroup.find(group => group.group === "missing or mixed label");
  assert.ok(missingExperienceGroup);
  assert.equal(missingExperienceGroup.top1AccuracyPercent, "insufficient data");
});

test("local dataset command emits only aggregate results", async () => {
  const fixture = datasetWithCases(6);
  const output = [];
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "freelancechain-evaluation-"));
  const datasetPath = path.join(tempDirectory, "consented.json");
  try {
    fs.writeFileSync(datasetPath, JSON.stringify(fixture), "utf8");
    const report = await runEvaluationCommand(["--dataset", datasetPath], { writeOutput: text => output.push(text) });
    assert.equal(report.sampleSize, 6);
    assert.equal(output.length, 1);
    assert.equal(output[0].includes("Build a product dashboard"), false);
    assert.equal(output[0].includes("candidate-a001"), false);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test("command only invokes the AI client when --ai is explicit", async () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  const fixture = datasetWithCases(1);
  const outputs = [];
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    const input = JSON.parse(options.body).input;
    return { ok: true, json: async () => ({ data: input.map((_, index) => ({ index, embedding: index < 2 ? [1, 0] : [0, 1] })) }) };
  };
  try {
    await runEvaluationCommand(["--dataset", "consented.json"], {
      readFile: () => JSON.stringify(fixture),
      fetchImpl,
      writeOutput: text => outputs.push(text),
    });
    assert.equal(calls, 0);
    const report = await runEvaluationCommand(["--dataset", "consented.json", "--ai"], {
      readFile: () => JSON.stringify(fixture),
      fetchImpl,
      writeOutput: text => outputs.push(text),
    });
    assert.equal(calls, 1);
    assert.equal(report.ai.status, "available");
    assert.equal(outputs.length, 2);
  } finally {
    if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior;
  }
});

test("offline evaluation never calls the network and reports AI unavailable", async () => {
  const prior = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  let calls = 0;
  try {
    const report = await evaluateDataset(datasetWithCases(2), { fetchImpl: async () => { calls += 1; throw new Error("unexpected network call"); } });
    assert.equal(calls, 0);
    assert.equal(report.method, "rule_based_offline");
    assert.equal(report.ai.status, "unavailable");
  } finally {
    if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior;
  }
});

test("AI stays unavailable without a key even when explicitly requested", async () => {
  const prior = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  let calls = 0;
  try {
    const report = await evaluateDataset(datasetWithCases(1), { includeAi: true, fetchImpl: async () => { calls += 1; throw new Error("unexpected network call"); } });
    assert.equal(report.ai.status, "unavailable");
    assert.equal(calls, 0);
  } finally {
    if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior;
  }
});

test("AI calls the injected client only after an explicit request and configured key", async () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    const input = JSON.parse(options.body).input;
    return { ok: true, json: async () => ({ data: input.map((_, index) => ({ index, embedding: index === 0 || index === 1 ? [1, 0] : [0, 1] })) }) };
  };
  try {
    const report = await evaluateDataset(datasetWithCases(1), { includeAi: true, fetchImpl });
    assert.equal(calls, 1);
    assert.equal(report.ai.status, "available");
    assert.equal(report.ai.sampleSize, 1);
    assert.equal(JSON.stringify(report).includes("product dashboard"), false);
    assert.equal(JSON.stringify(report).includes("I will implement"), false);
    assert.equal(JSON.stringify(report).includes("candidate-01"), false);
  } finally {
    if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior;
  }
});
