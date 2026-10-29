const test = require("node:test"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), zlib = require("node:zlib"), express = require("express");
const fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { BSON } = require("mongoose").mongo;
const { unzipSync } = require("fflate");
const { settings, capture, encrypt, createRouter, MAX_RAW } = require("./cloudBackup");
const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 3072 });
const env = { CLOUD_BACKUP_SCRIPT_CLIENT_ID: "test-owner.apps.googleusercontent.com", CLOUD_BACKUP_OWNER_EMAIL: "owner@example.test",
  CLOUD_BACKUP_PUBLIC_KEY: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64") };
const config = settings(env);
test("backup config fails closed for missing identity, private keys and weak RSA", () => {
  assert.equal(settings({}), null); assert.equal(settings({ ...env, CLOUD_BACKUP_OWNER_EMAIL: "invalid" }), null);
  assert.equal(settings({ ...env, CLOUD_BACKUP_PUBLIC_KEY: pair.privateKey.export({ type: "pkcs8", format: "pem" }) }), null);
  const weak = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
  assert.equal(settings({ ...env, CLOUD_BACKUP_PUBLIC_KEY: weak.publicKey.export({ type: "spki", format: "der" }).toString("base64") }), null);
  assert.match(config.fingerprint, /^[a-f0-9]{64}$/);
});
test("standard JWE encrypts without the recovery key; correct key decrypts and changed ciphertext fails", async () => {
  const { compactDecrypt } = await import("jose"), input = Buffer.from("fictional secret record");
  const ciphertext = await encrypt(input, pair.publicKey);
  assert.equal(ciphertext.includes("fictional"), false);
  const decrypted = await compactDecrypt(ciphertext, pair.privateKey, { keyManagementAlgorithms: ["RSA-OAEP-256"], contentEncryptionAlgorithms: ["A256GCM"] });
  assert.deepEqual(Buffer.from(decrypted.plaintext), input);
  const parts = ciphertext.split("."); parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  await assert.rejects(compactDecrypt(parts.join("."), pair.privateKey));
});
function fixture(options = {}) {
  const bytes = Buffer.from("fictional attachment"), id = new BSON.ObjectId(), when = new Date("2026-10-29T00:00:00Z");
  const data = { users: [{ _id: id, when, amount: BSON.Long.fromString("9223372036854775806"), marker: options.large || "fictional owner" }],
    attachments: [{ storageBackend: "mongo", storageKey: "file-id", size: bytes.length }],
    privatefiles: [{ _id: "file-id", data: new BSON.Binary(bytes), sha256: crypto.createHash("sha256").update(bytes).digest("hex") }],
    sessions: [{ tokenHash: "must-not-export" }] };
  if (options.corrupt) data.privatefiles[0].sha256 = "wrong";
  const session = { snapshotTime: null, ended: false, endSession: async () => { session.ended = true; } };
  const findSessions = []; let metadataReads = 0;
  const db = {
    listCollections() {
      metadataReads++;
      return { toArray: async () => Object.keys(data).map(name => ({ name, type: "collection", options: {},
        info: { uuid: options.schemaChange && metadataReads > 1 && name === "users" ? "changed" : name } })) };
    },
    collection(name) { return {
      listIndexes: () => ({ toArray: async () => [{ name: "_id_", key: { _id: 1 } }] }),
      find(query, opts) {
        assert.equal(opts.session, session); findSessions.push(opts.session);
        if (!options.noSnapshotTime) session.snapshotTime = new BSON.Timestamp({ t: 1000, i: 1 });
        return (async function* () { for (const doc of data[name] || []) yield doc; })();
      },
      findOne: async (query, opts) => { assert.equal(opts.session, session); return data.privatefiles[0]; }
    }; }
  };
  const client = { db: name => { assert.equal(name, "synthetic"); return db; }, startSession: opts => {
    assert.deepEqual(opts, { snapshot: true, causalConsistency: false }); return session;
  } };
  return { client, session, findSessions };
}
test("logical capture pins every document/file read to one snapshot session and preserves BSON", async () => {
  const input = fixture(), result = await capture({ client: input.client, database: "synthetic" });
  assert.equal(input.session.ended, true); assert.equal(result.summary.attachments, 1);
  const files = unzipSync(result.zip), manifest = JSON.parse(Buffer.from(files["snapshot/manifest.json"]));
  assert.equal(manifest.consistency.mode, "session-snapshot"); assert.equal(manifest.consistency.metadataCheckedStable, true);
  assert.equal(manifest.collections.some(item => item.collection === "sessions"), false);
  for (const file of manifest.collections) {
    const bytes = Buffer.from(files["snapshot/" + file.name]);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), file.sha256);
  }
  const users = manifest.collections.find(item => item.collection === "users");
  const restored = BSON.EJSON.parse(zlib.gunzipSync(files["snapshot/" + users.name]).toString(), { relaxed: false });
  assert.equal(String(restored.amount), "9223372036854775806"); assert.ok(restored.when instanceof Date);
  const report = JSON.parse(Buffer.from(files["backup-report.json"]));
  assert.equal(report.restoreRehearsalPerformed, false);
});
test("capture rejects corrupted attachments, changing schema, missing snapshot guarantees and excess data", async () => {
  for (const options of [{ corrupt: true }, { schemaChange: true }, { noSnapshotTime: true }, { large: "x".repeat(MAX_RAW + 1) }]) {
    const input = fixture(options);
    await assert.rejects(capture({ client: input.client, database: "synthetic" }));
    assert.equal(input.session.ended, true);
  }
});
test("the owner recovery reader decrypts and verifies an actual generated archive without touching a database", async () => {
  const input = fixture(), snapshot = await capture({ client: input.client, database: "synthetic" });
  const ciphertext = await encrypt(snapshot.zip, pair.publicKey);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fc-cloud-decrypt-test-"));
  try {
    const report = await require("./scripts/decryptCloudBackup").unpack(ciphertext, pair.privateKey, path.join(root, "new-only"));
    assert.equal(report.documents, 3); assert.equal(report.snapshotIntegrityVerified, true);
    assert.equal(report.databaseRestorePerformed, false);
  } finally {
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith("fc-cloud-decrypt-test-")) await fs.rm(root, { recursive: true, force: true });
  }
});
test("HTTP export requires the pinned verified Google identity and ignores browser cookies", async () => {
  const token = "x".repeat(60); let exports = 0, payload = { sub: "synthetic-owner", email: config.owner, email_verified: true, aud: config.audience };
  const app = express(); app.use("/backup", createRouter({ getSettings: () => config, verifyToken: async (value, audience) => {
    assert.equal(value, token); assert.equal(audience, config.audience); return payload;
  }, getClient: () => ({}), getDatabase: () => "synthetic", getStorage: () => "mongo",
  captureSnapshot: async () => { exports++; return { zip: Buffer.from("synthetic-only"), summary: { createdAt: "2026-10-29T00:00:00.000Z" } }; } }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const url = "http://127.0.0.1:" + server.address().port + "/backup";
  try {
    assert.equal((await fetch(url + "/export", { method: "POST", headers: { Cookie: "admin=fictional" } })).status, 401);
    assert.equal((await fetch(url + "/export", { method: "POST", headers: { Authorization: "Bearer " + token, Origin: "https://example.test" } })).status, 403);
    payload = { ...payload, email: "other@example.test" };
    assert.equal((await fetch(url + "/export", { method: "POST", headers: { Authorization: "Bearer " + token } })).status, 403);
    payload = { ...payload, email: config.owner, aud: "wrong.apps.googleusercontent.com" };
    assert.equal((await fetch(url + "/status", { headers: { Authorization: "Bearer " + token } })).status, 403);
    payload = { ...payload, aud: config.audience };
    const response = await fetch(url + "/export", { method: "POST", headers: { Authorization: "Bearer " + token } });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    const bundle = await response.json();
    assert.equal(bundle.keyFingerprint, config.fingerprint);
    assert.equal(crypto.createHash("sha256").update(bundle.ciphertext).digest("hex"), bundle.sha256);
    assert.equal(exports, 1);
    assert.equal((await fetch(url + "/export", { method: "POST", headers: { Authorization: "Bearer " + token } })).status, 429);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
