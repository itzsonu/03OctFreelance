// Offline, label-free collection -> blinded reviewer packets -> adjudicated datasets.
// No MongoDB, .env loading, provider calls or automatic human-provenance claims.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { validateResearchDataset, checkOverlap, evaluateResearch } = require("./researchEvaluation");
const REVIEW_HEADERS = ["caseId", "candidateId", "reviewerToken", "relevance", "reason", "rubricVersion"];
const ADJ_HEADERS = ["caseId", "candidateId", "relevance", "reason"];
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const clone = value => JSON.parse(JSON.stringify(value));
const key = (caseId, candidateId) => caseId + "/" + candidateId;
const keys = (object, allowed) => {
  if (!object || typeof object !== "object" || Array.isArray(object) || Object.keys(object).some(name => !allowed.includes(name))) throw new Error("Unexpected study fields");
};
function implementationHashes() {
  return Object.fromEntries(["scoring.js", "money.js", "semanticMatching.js", "matchingEvaluation.js", "researchEvaluation.js", "reviewWorkflow.js"]
    .map(name => [name, hash(fs.readFileSync(path.join(__dirname, name)))]));
}
function validateCollection(source) {
  keys(source, ["schemaVersion", "provenance", "cases"]); const p = source.provenance;
  keys(p, ["sourceType", "datasetToken", "consented", "anonymized", "externalProcessingConsented"]);
  if (source.schemaVersion !== 1 || !["synthetic", "independent_consented"].includes(p.sourceType) ||
    typeof p.consented !== "boolean" || p.anonymized !== true || typeof p.externalProcessingConsented !== "boolean" ||
    (p.sourceType === "synthetic" && p.consented) || (p.sourceType === "independent_consented" && !p.consented) ||
    !Array.isArray(source.cases) || !source.cases.length) throw new Error("Supply actual anonymized collection cases and truthful source declarations");
  for (const item of source.cases) {
    keys(item, ["caseId", "groupToken", "split", "project", "candidates"]);
    if (!["development", "holdout"].includes(item.split) || !Array.isArray(item.candidates) || !item.candidates.length) throw new Error("Freeze the development/holdout split before labelling");
  }
  // Temporary first-candidate IDs exist ONLY inside the shared structural validator.
  // They are never exported, scored, saved or treated as relevance ground truth.
  validateResearchDataset({ schemaVersion: 2, provenance: {
    sourceType: "synthetic", datasetToken: p.datasetToken, consented: false, anonymized: true,
    independentLabels: false, scoresHiddenDuringLabelling: false, reviewerCount: 0,
    holdoutUnusedForTuning: false, split: "development", externalProcessingConsented: false
  }, cases: source.cases.map(({ split, ...item }) => ({ ...item, relevantApplicantIds: [item.candidates[0].id] })) });
  return source;
}
function shuffled(items, random = crypto.randomInt) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = random(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function cell(value) {
  let text = String(value);
  if (/^\s*[=+@-]/.test(text)) text = "'" + text; // Avoid spreadsheet formula execution.
  return '"' + text.replace(/"/g, '""') + '"';
}
function csv(rows) { return rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n"; }
function parseCsv(text, headers) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 5 * 1024 * 1024) throw new Error("Reviewer file exceeds limits");
  text = text.replace(/^\uFEFF/, "");
  const rows = []; let row = [], value = "", quoted = false, closed = false;
  function finishRow() { row.push(value); if (row.length !== 1 || row[0] !== "") rows.push(row); row = []; value = ""; closed = false; }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else value += char;
    } else if (char === ",") { row.push(value); value = ""; closed = false; }
    else if (char === "\n" || char === "\r") { if (char === "\r" && text[i + 1] === "\n") i++; finishRow(); }
    else if (char === '"' && !value && !closed) quoted = true;
    else { if (closed || char === '"') throw new Error("Invalid quoted CSV field"); value += char; }
  }
  if (quoted) throw new Error("Unclosed quoted CSV field");
  if (row.length || value || closed) finishRow();
  if (!rows.length || JSON.stringify(rows.shift()) !== JSON.stringify(headers)) throw new Error("Unexpected reviewer/adjudication CSV columns");
  if (rows.some(row => row.length !== headers.length)) throw new Error("Reviewer/adjudication row has wrong column count");
  return rows.map(row => Object.fromEntries(headers.map((header, i) => [header, row[i]])));
}
function reason(text) {
  if (typeof text !== "string" || !text.trim() || text.length > 1000 || /@|\bhttps?:\/\/|\bwww\.|(?:\+?\d[\d ().-]{8,}\d)/i.test(text)) throw new Error("Supply an anonymized, non-empty grounded review reason");
}
function makePacket(source, random = crypto.randomInt) {
  validateCollection(source);
  const packet = { schemaVersion: 1, createdAt: new Date().toISOString(), source: clone(source),
    sourceHash: hash(JSON.stringify(source)), implementationHashes: implementationHashes(), reviewers: [] };
  const template = fs.readFileSync(path.join(__dirname, "../research/reviewer.template.html"), "utf8");
  const forms = ["A", "B"].map(label => {
    const reviewerToken = "reviewer-" + crypto.randomBytes(8).toString("hex");
    const cases = shuffled(source.cases, random).map(item => ({
      caseId: item.caseId, project: clone(item.project),
      candidates: shuffled(item.candidates, random).map(({ id, profile, proposal }) => ({ id, profile: clone(profile), proposal }))
    }));
    packet.reviewers.push({ label, reviewerToken });
    const data = { reviewerToken, evidenceType: source.provenance.sourceType, cases };
    const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    return { label, reviewerToken, html: template.replace("__BLIND_DATA_JSON__", () => json),
      csv: csv([REVIEW_HEADERS, ...cases.flatMap(item => item.candidates.map(candidate => [item.caseId, candidate.id, reviewerToken, "", "", "relevance-v1"]))]) };
  });
  return { packet, forms };
}
function evidenceTemplate() { return {
  schemaVersion: 1, humanAnonymizationChecked: false, reviewersIndependentlyCompleted: false,
  scoresHiddenDuringLabelling: false, holdoutUnusedForTuning: false,
  note: "Coordinator declarations require real supporting evidence; software cannot verify participant consent or reviewer independence."
}; }
function mergeReviews(packet, csvA, csvB, adjudicationCsv, evidence) {
  keys(packet, ["schemaVersion", "createdAt", "source", "sourceHash", "implementationHashes", "reviewers"]);
  if (packet.schemaVersion !== 1 || packet.sourceHash !== hash(JSON.stringify(packet.source)) ||
    JSON.stringify(packet.implementationHashes) !== JSON.stringify(implementationHashes()) ||
    !Array.isArray(packet.reviewers) || packet.reviewers.length !== 2 || packet.reviewers[0].reviewerToken === packet.reviewers[1].reviewerToken) throw new Error("Frozen packet/source implementation changed; review before proceeding");
  packet.reviewers.forEach((reviewer, i) => {
    keys(reviewer, ["label", "reviewerToken"]);
    if (reviewer.label !== ["A", "B"][i] || !/^reviewer-[a-f0-9]{16}$/.test(reviewer.reviewerToken)) throw new Error("Invalid anonymous reviewer assignment");
  });
  validateCollection(packet.source);
  keys(evidence, ["schemaVersion", "humanAnonymizationChecked", "reviewersIndependentlyCompleted", "scoresHiddenDuringLabelling", "holdoutUnusedForTuning", "note"]);
  const declarations = ["humanAnonymizationChecked", "reviewersIndependentlyCompleted", "scoresHiddenDuringLabelling", "holdoutUnusedForTuning"];
  if (evidence.schemaVersion !== 1 || declarations.some(name => typeof evidence[name] !== "boolean")) throw new Error("Declare the review evidence explicitly");
  if (packet.source.provenance.sourceType === "independent_consented" && declarations.some(name => evidence[name] !== true)) throw new Error("Independent data needs real anonymization, two blinded reviewers and an untouched holdout declaration");
  const expected = new Set(packet.source.cases.flatMap(item => item.candidates.map(candidate => key(item.caseId, candidate.id))));
  const sheets = [csvA, csvB].map((text, i) => {
    const rows = parseCsv(text, REVIEW_HEADERS), map = new Map();
    for (const row of rows) {
      const id = key(row.caseId, row.candidateId);
      if (!expected.has(id) || map.has(id) || row.reviewerToken !== packet.reviewers[i].reviewerToken ||
        !["0", "1", "uncertain"].includes(row.relevance) || row.rubricVersion !== "relevance-v1") throw new Error("Unknown, duplicate, incomplete or incorrectly attributed reviewer row");
      reason(row.reason); map.set(id, row);
    }
    if (map.size !== expected.size) throw new Error("Every candidate needs a completed row from each reviewer");
    return map;
  });
  const decisions = new Map();
  for (const row of parseCsv(adjudicationCsv || csv([ADJ_HEADERS]), ADJ_HEADERS)) {
    const id = key(row.caseId, row.candidateId);
    if (!expected.has(id) || decisions.has(id) || !["0", "1"].includes(row.relevance)) throw new Error("Invalid or duplicate adjudication");
    reason(row.reason); decisions.set(id, row);
  }
  let disagreements = 0, agreed = 0, binaryPairs = 0, adjudicated = 0;
  const labels = new Map();
  for (const id of expected) {
    const a = sheets[0].get(id).relevance, b = sheets[1].get(id).relevance;
    if (a !== "uncertain" && b !== "uncertain") binaryPairs++;
    if (a === b && a !== "uncertain") {
      if (decisions.has(id)) throw new Error("Do not overwrite an agreed label through adjudication");
      agreed++; labels.set(id, a);
    } else {
      disagreements++; const decision = decisions.get(id);
      if (!decision) throw new Error("Disagreements and uncertain labels require documented human adjudication");
      labels.set(id, decision.relevance); adjudicated++;
    }
  }
  const excluded = [], sets = {};
  for (const split of ["development", "holdout"]) {
    const cases = [];
    for (const item of packet.source.cases.filter(item => item.split === split)) {
      const relevantApplicantIds = item.candidates.filter(candidate => labels.get(key(item.caseId, candidate.id)) === "1").map(candidate => candidate.id);
      if (!relevantApplicantIds.length) { excluded.push({ caseId: item.caseId, split, reason: "no_relevant_candidate" }); continue; }
      const { split: ignored, ...record } = item; cases.push({ ...clone(record), relevantApplicantIds });
    }
    if (!cases.length) continue;
    const p = packet.source.provenance;
    sets[split] = validateResearchDataset({ schemaVersion: 2, provenance: {
      sourceType: p.sourceType, datasetToken: "dataset-" + hash(packet.sourceHash + "/" + split).slice(0,20),
      consented: p.consented, anonymized: p.anonymized, externalProcessingConsented: p.externalProcessingConsented,
      independentLabels: evidence.reviewersIndependentlyCompleted, scoresHiddenDuringLabelling: evidence.scoresHiddenDuringLabelling,
      reviewerCount: evidence.reviewersIndependentlyCompleted ? 2 : 0,
      holdoutUnusedForTuning: evidence.holdoutUnusedForTuning, split
    }, cases });
  }
  if (sets.holdout && sets.development) checkOverlap(sets.holdout, sets.development);
  if (Object.values(sets).some(dataset => Buffer.byteLength(JSON.stringify(dataset)) > 5 * 1024 * 1024)) throw new Error("Final evaluation dataset exceeds 5 MB");
  return { sets, audit: { sourceHash: packet.sourceHash, sourceType: packet.source.provenance.sourceType,
    reviewerSheetHashes: [hash(csvA), hash(csvB)], adjudicationHash: hash(adjudicationCsv || csv([ADJ_HEADERS])),
    evidenceDeclarationsHash: hash(JSON.stringify(evidence)), providedSheets: 2, candidatePairs: expected.size,
    agreedBinaryLabels: agreed, binaryPairs, rawBinaryAgreement: binaryPairs ? agreed / binaryPairs : null,
    disagreementOrUncertainPairs: disagreements, adjudicatedPairs: adjudicated, excludedCases: excluded,
    provenanceClaimsIndependentlyVerifiedByTool: false, realWorldAccuracyMeasured: false } };
}
function readJson(file) {
  const text = readText(file);
  try { return JSON.parse(text); }
  catch { throw new Error("Study JSON is invalid; correct it privately without sharing its contents"); }
}
function readText(file) {
  if (fs.statSync(file).size > 5 * 1024 * 1024) throw new Error("Study input exceeds 5 MB");
  return fs.readFileSync(file, "utf8");
}
function newOutput(directory) {
  const resolved = path.resolve(directory), repo = path.resolve(__dirname, ".."), relative = path.relative(repo, resolved);
  if (!relative || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) throw new Error("Keep private study outputs outside the repository");
  if (process.platform === "win32" && !process.env.FC_PRIVATE_RESEARCH_ROOT) throw new Error("Use the private PowerShell study launcher on Windows");
  if (process.env.FC_PRIVATE_RESEARCH_ROOT) {
    const base = path.resolve(process.env.FC_PRIVATE_RESEARCH_ROOT), rel = path.relative(base, resolved);
    if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) throw new Error("Use a NEW output inside the restricted study folder");
    if (path.relative(base, fs.realpathSync(base)) !== "" || path.relative(path.dirname(resolved), fs.realpathSync(path.dirname(resolved))) !== "") throw new Error("Linked private output paths are not accepted");
  }
  fs.mkdirSync(resolved, { mode: 0o700 }); return resolved;
}
function writeJson(root, name, data) { fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
async function runReviewCommand(argv = process.argv.slice(2)) {
  const command = argv[0], args = {};
  for (let i = 1; i < argv.length; i += 2) {
    if (!["--source", "--out", "--packet", "--reviewer-a", "--reviewer-b", "--adjudications", "--evidence"].includes(argv[i]) ||
      args[argv[i]] || !argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error("Unsupported/duplicate study option");
    args[argv[i]] = argv[i + 1];
  }
  if (!args["--out"]) throw new Error("Supply --out with a new private output folder");
  if (command === "pack") {
    if (!args["--source"] || Object.keys(args).length !== 2) throw new Error("pack requires only --source and --out");
    const { packet, forms } = makePacket(readJson(args["--source"]));
    const coordinatorText = JSON.stringify(packet) + "\n";
    if (Buffer.byteLength(coordinatorText) > 5 * 1024 * 1024) throw new Error("Frozen study packet exceeds 5 MB; reduce the collection before review");
    const root = newOutput(args["--out"]);
    fs.writeFileSync(path.join(root, "coordinator.json"), coordinatorText, { flag: "wx", mode: 0o600 });
    writeJson(root, "evidence.template.json", evidenceTemplate());
    fs.writeFileSync(path.join(root, "adjudications.template.csv"), csv([ADJ_HEADERS]), { flag: "wx", mode: 0o600 });
    for (const form of forms) {
      const folder = path.join(root, "reviewer-" + form.label); fs.mkdirSync(folder, { mode: 0o700 });
      fs.writeFileSync(path.join(folder, "review.html"), form.html, { flag: "wx", mode: 0o600 });
      fs.writeFileSync(path.join(folder, "labels.csv"), form.csv, { flag: "wx", mode: 0o600 });
    }
    return { status: "blinded_packets_ready", cases: packet.source.cases.length, sourceType: packet.source.provenance.sourceType,
      sourceHash: packet.sourceHash, output: root, actualHumanLabelsCollected: 0, realWorldAccuracyMeasured: false };
  }
  if (command !== "merge" || !args["--packet"] || !args["--reviewer-a"] || !args["--reviewer-b"] || !args["--evidence"] || args["--source"]) throw new Error("merge requires packet, both reviewer files, evidence and new output");
  const result = mergeReviews(readJson(args["--packet"]), readText(args["--reviewer-a"]),
    readText(args["--reviewer-b"]), args["--adjudications"] ? readText(args["--adjudications"]) : null, readJson(args["--evidence"]));
  const reports = {};
  for (const [split, dataset] of Object.entries(result.sets)) reports[split] = await evaluateResearch(dataset,
    { development: split === "holdout" ? result.sets.development : undefined, fetchImpl: async () => { throw new Error("Offline study tool forbids network access"); } });
  const root = newOutput(args["--out"]); writeJson(root, "annotation-audit.json", result.audit);
  for (const [split, dataset] of Object.entries(result.sets)) { writeJson(root, split + ".json", dataset); writeJson(root, split + "-report.json", reports[split]); }
  return { status: Object.keys(result.sets).length ? "offline_reports_ready" : "all_cases_excluded_no_metrics",
    sourceType: result.audit.sourceType, output: root, excludedCases: result.audit.excludedCases.length,
    provenanceClaimsIndependentlyVerifiedByTool: false };
}
module.exports = { validateCollection, makePacket, mergeReviews, parseCsv, csv, REVIEW_HEADERS, ADJ_HEADERS, evidenceTemplate, runReviewCommand };
if (require.main === module) runReviewCommand().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  console.error(error.code ? "Study file operation failed (" + error.code + ")." : "Study workflow stopped: " + error.message); process.exitCode = 1;
});
