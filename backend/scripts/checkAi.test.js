const test = require("node:test");
const assert = require("node:assert/strict");
const { checkAi } = require("./checkAi");

test("AI configuration checks never send requests unless live is explicitly requested", async () => {
  const prior = process.env.OPENAI_API_KEY;
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("Should not call"); };
  try {
    process.env.OPENAI_API_KEY = "test-only-key";
    assert.equal((await checkAi({ fetchImpl })).liveVerified, false);
    delete process.env.OPENAI_API_KEY;
    assert.equal((await checkAi({ live: true, fetchImpl })).configured, false);
    assert.equal(calls, 0);
  } finally { if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior; }
});

test("live checker uses only synthetic inputs and reports each failed feature without retries", async () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  const payloads = [];
  const fetchImpl = async (url, options) => { payloads.push(JSON.parse(options.body)); return { ok: false, status: 401 }; };
  try {
    const result = await checkAi({ live: true, fetchImpl });
    assert.equal(result.planningVerified, false);
    assert.equal(result.matchingVerified, false);
    assert.equal(result.liveVerified, false);
    assert.equal(payloads.length, 2);
    assert.match(payloads[0].input, /Synthetic dashboard demo/);
    assert.match(payloads[1].input[1], /Synthetic demonstration profile/);
    assert.doesNotMatch(JSON.stringify(result), /test-only-key/);
  } finally { if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior; }
});

test("both successful synthetic responses are needed for live verification", async () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    return { ok: true, json: async () => url.endsWith("/responses")
      ? { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ milestones: [
        { title: "Scope", description: "Review the scope.", weight: 30, dependsOn: [] },
        { title: "Deliver", description: "Review working files.", weight: 70, dependsOn: [0] },
      ] }) }] }] }
      : { data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [1, 0] }] } };
  };
  try {
    const result = await checkAi({ live: true, fetchImpl });
    assert.equal(result.planningVerified, true);
    assert.equal(result.matchingVerified, true);
    assert.equal(result.liveVerified, true);
    assert.equal(calls, 2);
  } finally { if (prior === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prior; }
});
