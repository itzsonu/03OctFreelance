const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm");
const w = require("./reviewWorkflow");
const example = require("../research/case-example.synthetic.json");
const clone = object => JSON.parse(JSON.stringify(object));
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
function source(count = 1) {
  const p = example.provenance;
  return { schemaVersion: 1, provenance: { sourceType: "synthetic", datasetToken: p.datasetToken, consented: false, anonymized: true, externalProcessingConsented: false },
    cases: Array.from({ length: count }, (_, i) => {
      const item = clone(example.cases[0]); delete item.relevantApplicantIds;
      item.caseId = "case-aa" + i; item.groupToken = "group-bb" + i; item.split = i ? "holdout" : "development";
      item.project.description += " Distinct practice audience segment " + i + ".";
      return item;
    }) };
}
function sheets(packet, decide = () => ["1","1"]) {
  return [0,1].map(i => w.csv([w.REVIEW_HEADERS, ...packet.source.cases.flatMap(item => item.candidates.map((candidate, index) =>
    [item.caseId, candidate.id, packet.reviewers[i].reviewerToken, decide(index, item.caseId)[i], "Documented scope and skills assessed independently.", "relevance-v1"]))]));
}
test("collection rejects old relevance answers, personal identifiers and false real-data consent", () => {
  const data = source(); assert.equal(w.validateCollection(data), data);
  const labelled = clone(data); labelled.cases[0].relevantApplicantIds = ["candidate-c73f"];
  assert.throws(() => w.validateCollection(labelled));
  const personal = clone(data); personal.cases[0].candidates[0].profile.email = "fictional@example.test";
  assert.throws(() => w.validateCollection(personal));
  const real = clone(data); real.provenance.sourceType = "independent_consented";
  assert.throws(() => w.validateCollection(real));
  assert.throws(() => w.validateCollection({ ...data, cases: [] }));
});
test("blinded packets hide labels/history/splits, contain blank labels and escape HTML data", () => {
  const data = source(); data.cases[0].candidates[0].proposal += " Literal code example: </script><script>throw 1</script>";
  const { packet, forms } = w.makePacket(data);
  assert.notEqual(packet.reviewers[0].reviewerToken, packet.reviewers[1].reviewerToken);
  for (const form of forms) {
    const match = /const DATA = ([^\n]+);\n/.exec(form.html); assert.ok(match);
    const blind = JSON.parse(match[1]); assert.equal(blind.cases.length, 1);
    assert.equal(Object.hasOwn(blind.cases[0], "split"), false); assert.equal(Object.hasOwn(blind.cases[0], "groupToken"), false);
    assert.equal(Object.hasOwn(blind.cases[0], "relevantApplicantIds"), false);
    assert.ok(blind.cases[0].candidates.every(item => !Object.hasOwn(item, "history")));
    assert.equal((form.html.match(/<script>/g) || []).length, 1);
    const script = form.html.split("<script>")[1].split("</script>")[0]; assert.doesNotThrow(() => new vm.Script(script));
    assert.match(form.html, /connect-src 'none'/); assert.doesNotMatch(script, /\bfetch\s*\(|\blocalStorage\b|\.innerHTML\s*=/);
    assert.ok(w.parseCsv(form.csv, w.REVIEW_HEADERS).every(row => row.relevance === "" && row.reason === ""));
  }
});
test("CSV supports quotes/newlines and neutralizes formula-like spreadsheet cells", () => {
  const rows = [["a","b"], ['Quoted, "scope"\nnext line', "=dangerous-formula"]];
  const parsed = w.parseCsv(w.csv(rows), ["a","b"]);
  assert.equal(parsed[0].a, rows[1][0]); assert.equal(parsed[0].b, "'=dangerous-formula");
  assert.throws(() => w.parseCsv('a,b\n"unclosed,x', ["a","b"]));
  assert.throws(() => w.parseCsv("wrong,b\nx,y", ["a","b"]));
});
test("importer refuses blank, duplicate, unknown, misattributed and identifying review rows", () => {
  const { packet, forms } = w.makePacket(source()), [a,b] = sheets(packet);
  assert.throws(() => w.mergeReviews(packet, forms[0].csv, b, null, w.evidenceTemplate()));
  const rows = w.parseCsv(a, w.REVIEW_HEADERS);
  function changed(mutator) { const copy=clone(rows);mutator(copy);return w.csv([w.REVIEW_HEADERS,...copy.map(row=>w.REVIEW_HEADERS.map(name=>row[name]))]); }
  for (const invalid of [
    changed(rows=>rows.push(rows[0])), changed(rows=>{rows[0].candidateId="candidate-unknown";}),
    changed(rows=>{rows[0].reviewerToken=packet.reviewers[1].reviewerToken;}),
    changed(rows=>{rows[0].reason="Email fictional@example.test";}), changed(rows=>rows.pop())
  ]) assert.throws(() => w.mergeReviews(packet, invalid, b, null, w.evidenceTemplate()));
});
test("uncertainty/disagreement needs adjudication; agreement cannot be overwritten", () => {
  const { packet } = w.makePacket(source()), [a,b] = sheets(packet, index => index === 0 ? ["uncertain","1"] : ["0","0"]);
  assert.throws(() => w.mergeReviews(packet,a,b,null,w.evidenceTemplate()));
  const first = packet.source.cases[0], candidate=first.candidates[0];
  const adjudicated = w.csv([w.ADJ_HEADERS,[first.caseId,candidate.id,"1","Clarified that the proposed deliverables cover the brief."]]);
  const result=w.mergeReviews(packet,a,b,adjudicated,w.evidenceTemplate());
  assert.equal(result.audit.adjudicatedPairs,1);assert.equal(result.audit.disagreementOrUncertainPairs,1);
  assert.deepEqual(result.sets.development.cases[0].relevantApplicantIds,[candidate.id]);
  const unnecessary=w.csv([w.ADJ_HEADERS,[first.caseId,first.candidates[1].id,"1","Attempted override."]]);
  assert.throws(()=>w.mergeReviews(packet,a,b,adjudicated+unnecessary.split("\r\n").slice(1).join("\r\n"),w.evidenceTemplate()));
});
test("frozen source/code and real human evidence are required; synthetic origin cannot be promoted", () => {
  const { packet }=w.makePacket(source(2)),[a,b]=sheets(packet,index=>index===0?["1","1"]:["0","0"]);
  const result=w.mergeReviews(packet,a,b,null,w.evidenceTemplate());
  assert.equal(result.sets.holdout.provenance.sourceType,"synthetic");assert.equal(result.sets.holdout.provenance.independentLabels,false);
  const changed=clone(packet);changed.source.cases[0].project.title="Changed after reviewers started";
  assert.throws(()=>w.mergeReviews(changed,a,b,null,w.evidenceTemplate()));
  const data=source(2);data.provenance.sourceType="independent_consented";data.provenance.consented=true;
  const independent=w.makePacket(data).packet,[ra,rb]=sheets(independent,index=>index===0?["1","1"]:["0","0"]);
  assert.throws(()=>w.mergeReviews(independent,ra,rb,null,w.evidenceTemplate()));
  const declared={...w.evidenceTemplate(),humanAnonymizationChecked:true,reviewersIndependentlyCompleted:true,scoresHiddenDuringLabelling:true,holdoutUnusedForTuning:true};
  const final=w.mergeReviews(independent,ra,rb,null,declared);
  assert.equal(final.sets.holdout.provenance.sourceType,"independent_consented");
  assert.equal(final.audit.provenanceClaimsIndependentlyVerifiedByTool,false); // Artificial test declarations are not real evidence.
});
test("no-relevant-candidate cases are excluded transparently without inventing positive labels", () => {
  const { packet }=w.makePacket(source()),[a,b]=sheets(packet,()=>["0","0"]);
  const result=w.mergeReviews(packet,a,b,null,w.evidenceTemplate());
  assert.deepEqual(result.sets,{});assert.equal(result.audit.excludedCases.length,1);assert.equal(result.audit.rawBinaryAgreement,1);
});
test("CLI packs blank forms and imports synthetic controls offline without overwriting or leaking invalid JSON", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fc-review-test-")));
  const oldRoot = process.env.FC_PRIVATE_RESEARCH_ROOT, originalFetch = global.fetch;
  process.env.FC_PRIVATE_RESEARCH_ROOT = root;
  let requests = 0; global.fetch = async () => { requests++; throw new Error("Unexpected network request"); };
  try {
    const input = path.join(root,"collection.json"), packed = path.join(root,"packet"), results = path.join(root,"results");
    fs.writeFileSync(input, JSON.stringify(source()));
    const command = ["pack","--source",input,"--out",packed];
    assert.equal((await w.runReviewCommand(command)).actualHumanLabelsCollected,0);
    await assert.rejects(w.runReviewCommand(command));
    const packetPath = path.join(packed,"coordinator.json"), packet = JSON.parse(fs.readFileSync(packetPath,"utf8"));
    const [a,b] = sheets(packet,index=>index===0?["1","1"]:["0","0"]);
    const aPath=path.join(root,"a.csv"), bPath=path.join(root,"b.csv");fs.writeFileSync(aPath,a);fs.writeFileSync(bPath,b);
    const outcome = await w.runReviewCommand(["merge","--packet",packetPath,"--reviewer-a",aPath,"--reviewer-b",bPath,
      "--evidence",path.join(packed,"evidence.template.json"),"--out",results]);
    assert.equal(outcome.status,"offline_reports_ready");
    const report=JSON.parse(fs.readFileSync(path.join(results,"development-report.json"),"utf8"));
    assert.equal(report.ai.status,"not_requested");assert.equal(report.researchComplete,false);assert.equal(requests,0);
    fs.writeFileSync(input,'{"secret-looking-private-text":broken}');
    await assert.rejects(w.runReviewCommand(["pack","--source",input,"--out",path.join(root,"invalid")]),error=>
      error.message.includes("Study JSON is invalid")&&!error.message.includes("secret-looking-private-text"));
    assert.equal(fs.existsSync(path.join(root,"invalid")),false);
  } finally {
    global.fetch=originalFetch;
    if(oldRoot===undefined)delete process.env.FC_PRIVATE_RESEARCH_ROOT;else process.env.FC_PRIVATE_RESEARCH_ROOT=oldRoot;
    const resolved=path.resolve(root);
    if(path.dirname(resolved)===fs.realpathSync(os.tmpdir())&&path.basename(resolved).startsWith("fc-review-test-"))fs.rmSync(resolved,{recursive:true,force:true});
  }
});
