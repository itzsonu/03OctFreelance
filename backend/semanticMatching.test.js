const test = require("node:test");
const assert = require("node:assert/strict");
const { cosineSimilarity, rankApplicants, projectText, applicantText } = require("./semanticMatching");

test("semantic matching validates vectors and limits transmitted fields", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.throws(() => cosineSimilarity([0, 0], [1, 0]), /Empty/);
  assert.throws(() => cosineSimilarity([1, 0], [1]), /dimensions/);
  const profileText = applicantText({ freelancer: { name: "Private Name", email: "private@example.test", profile: { skills: ["React"], bio: "Builds interfaces", portfolioUrl: "https://private.example.test" } }, proposal: "I can deliver this work" });
  assert.match(profileText, /Builds interfaces/);
  assert.doesNotMatch(profileText, /Private Name|private@example|private\.example/);
  assert.match(projectText({ title: "Site", requiredSkills: ["React"], description: "Build a site" }), /Required skills: React/);
});

test("AI-assisted ranking blends semantic similarity with explained regular fit", async () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  let payload;
  const fakeFetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, json: async () => ({ data: [
      { index: 2, embedding: [0, 1] },
      { index: 0, embedding: [1, 0] },
      { index: 1, embedding: [1, 0] },
    ] }) };
  };
  try {
    const applications = [
      { _id: "a", proposal: "Build a dashboard", freelancer: { profile: { skills: ["React"] } }, match: { score: 70, matchedSkills: ["React"], missingSkills: [], yearsExperience: 2, trustIncluded: false }, trust: { score: null, approvedMilestones: 0, revisionRequests: 0 } },
      { _id: "b", proposal: "Write copy", freelancer: { profile: { skills: ["Writing"] } }, match: { score: 80, matchedSkills: [], missingSkills: ["React"], yearsExperience: 5, trustIncluded: true }, trust: { score: 70, approvedMilestones: 4, scoredMilestones: 3, clientCount: 1, revisionRequests: 0 } },
    ];
    const result = await rankApplicants({ title: "Dashboard", description: "Build a responsive dashboard", requiredSkills: ["React"] }, applications, fakeFetch);
    assert.equal(payload.model, "text-embedding-3-small");
    assert.equal(payload.input.length, 3);
    assert.deepEqual(result.ranking.map(item => item.applicationId), ["a", "b"]);
    assert.equal(result.ranking[0].score, 88);
    assert.equal(result.ranking[1].score, 32);
    assert.deepEqual(result.ranking[0].matchedSkills, ["React"]);
    assert.equal(result.ranking[1].evidence.scoredMilestones, 3);
    assert.match(result.explanation, /not hiring probabilities/);
  } finally {
    if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior;
  }
});

test("malformed or failed embedding responses cannot become a ranking", async () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  const applicants = [{ _id: "a", freelancer: { profile: {} }, match: { score: 70 } }];
  try {
    for (const response of [
      { ok: false, status: 503 },
      { ok: true, json: async () => ({ data: [] }) },
      { ok: true, json: async () => ({ data: [null, { index: 1, embedding: [1, 0] }] }) },
      { ok: true, json: async () => ({ data: [{ index: 0, embedding: [0, 0] }, { index: 1, embedding: [1, 0] }] }) },
      { ok: true, json: async () => ({ data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [NaN, 0] }] }) },
    ]) {
      let calls = 0;
      await assert.rejects(() => rankApplicants({}, applicants, async () => { calls++; return response; }));
      assert.equal(calls, 1);
    }
    let calls = 0;
    await assert.rejects(() => rankApplicants({}, [{ ...applicants[0], match: { score: NaN } }], async () => { calls++; }), /Invalid applicant/);
    assert.equal(calls, 0);
  } finally { if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior; }
});
