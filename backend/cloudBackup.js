const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { OAuth2Client } = require("google-auth-library");
const { BSON } = require("mongoose").mongo;
const { zipSync } = require("fflate");
const express = require("express");
const EXCLUDED = new Set(["sessions", "ratebuckets", "google_login_challenges", "_recovery_claim"]);
const MAX_RAW = 32 * 1024 * 1024, MAX_ZIP = 16 * 1024 * 1024;
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function fail(code) { const error = new Error(code); error.backupCode = code; throw error; }
function settings(env = process.env) {
  const audience = env.CLOUD_BACKUP_SCRIPT_CLIENT_ID, owner = env.CLOUD_BACKUP_OWNER_EMAIL?.trim().toLowerCase();
  if (!audience || !owner || !env.CLOUD_BACKUP_PUBLIC_KEY) return null;
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(audience) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) return null;
  try {
    const encoded = env.CLOUD_BACKUP_PUBLIC_KEY.trim();
    if (encoded.length > 2048 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
    const key = crypto.createPublicKey({ key: Buffer.from(encoded, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength < 3072) return null;
    return { audience, owner, key, fingerprint: sha(key.export({ format: "der", type: "spki" })) };
  } catch { return null; }
}
async function metadata(db) {
  const collections = (await db.listCollections({}, { maxTimeMS: 5000 }).toArray())
    .filter(item => !EXCLUDED.has(item.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (!collections.length || collections.length > 200) fail("collection_limit");
  const result = [];
  for (const collection of collections) {
    if (collection.type !== "collection" || collection.name.startsWith("system.") || collection.options?.timeseries) fail("unsupported_collection");
    const indexes = (await db.collection(collection.name).listIndexes({ maxTimeMS: 5000 }).toArray()).sort((a, b) => a.name.localeCompare(b.name));
    result.push({ name: collection.name, options: collection.options || {}, uuid: collection.info?.uuid, indexes });
  }
  return result;
}
async function capture({ client, database, now = () => new Date() }) {
  const db = client.db(database), before = await metadata(db);
  const session = client.startSession({ snapshot: true, causalConsistency: false });
  const started = Date.now(), files = Object.create(null);
  const manifest = { format: "freelancechain-offline-ejson", version: 1, sourceDatabase: database,
    createdAt: now().toISOString(), excludedCollections: [...EXCLUDED], collections: [], uploads: [] };
  let rawBytes = 0, compressedBytes = 0, documents = 0, attachments = 0;
  try {
    for (const collection of before) {
      const lines = []; let count = 0;
      for await (const doc of db.collection(collection.name).find({}, { session, maxTimeMS: 5000, batchSize: 100, promoteValues: false, promoteLongs: false })) {
        const line = BSON.EJSON.stringify(doc, null, 0, { relaxed: false }) + "\n";
        rawBytes += Buffer.byteLength(line); count++; documents++;
        if (rawBytes > MAX_RAW || Date.now() - started > 90000) fail("snapshot_limit");
        lines.push(line);
      }
      if (!session.snapshotTime) fail("snapshot_isolation_unavailable");
      const name = "collection-" + String(manifest.collections.length).padStart(4, "0") + ".jsonl.gz";
      const bytes = zlib.gzipSync(lines.join("")); compressedBytes += bytes.length;
      if (compressedBytes > MAX_ZIP) fail("snapshot_limit");
      files["snapshot/" + name] = bytes;
      manifest.collections.push({ name, collection: collection.name, count, size: bytes.length, sha256: sha(bytes),
        metadata: BSON.EJSON.stringify({ options: collection.options, indexes: collection.indexes }, null, 0, { relaxed: false }) });
    }
    for await (const attachment of db.collection("attachments").find({}, { session, maxTimeMS: 5000, batchSize: 100 })) {
      if (attachment.storageBackend !== "mongo") fail("local_uploads_unsupported");
      const file = await db.collection("privatefiles").findOne({ _id: attachment.storageKey }, { session, maxTimeMS: 5000 });
      const bytes = file?.data?.buffer;
      if (!bytes || bytes.length !== attachment.size || sha(bytes) !== file.sha256) fail("attachment_integrity");
      attachments++;
      if (Date.now() - started > 90000) fail("snapshot_limit");
    }
    const after = await metadata(db);
    if (BSON.EJSON.stringify(before) !== BSON.EJSON.stringify(after)) fail("schema_changed");
    manifest.consistency = { mode: "session-snapshot", atClusterTime: BSON.EJSON.stringify(session.snapshotTime),
      metadataCheckedStable: true, schemaMigrationsMustNotOverlap: true };
    files["snapshot/manifest.json"] = Buffer.from(JSON.stringify(manifest));
    files["backup-report.json"] = Buffer.from(JSON.stringify({ createdAt: manifest.createdAt, sourceDatabase: database,
      consistency: manifest.consistency, collections: manifest.collections.length, documents, attachments,
      attachmentHashesVerified: true, restoreRehearsalPerformed: false, excludedCollections: [...EXCLUDED] }));
    files["READ_ME.txt"] = Buffer.from("FreelanceChain cloud logical snapshot. Decrypt JWE with the separate owner private key, then unzip into a NEW private directory. Verify snapshot/ using backend/recovery.js. Restore only to a NEW isolated freelancechain_restore_* database. Do not overwrite production. Session data is excluded; the existing restore tool invalidates recovery tokens. This archive does not prove that a restore rehearsal was performed. Avoid schema migrations during the snapshot.\n");
    const zip = zipSync(files, { level: 0 });
    if (zip.length > MAX_ZIP) fail("snapshot_limit");
    return { zip, summary: { createdAt: manifest.createdAt, collections: manifest.collections.length, documents, attachments } };
  } finally { await session.endSession(); }
}
async function encrypt(zip, key) {
  const { CompactEncrypt } = await import("jose");
  return new CompactEncrypt(zip).setProtectedHeader({ alg: "RSA-OAEP-256", enc: "A256GCM", typ: "fc-backup+zip", v: 1 }).encrypt(key);
}
function createRouter({ getClient = () => require("mongoose").connection.getClient(),
  getDatabase = () => require("mongoose").connection.name, getStorage = () => require("./fileStorage").storageBackend(),
  getSettings = settings, verifyToken, captureSnapshot = capture, encryptSnapshot = encrypt } = {}) {
  const router = express.Router(), google = new OAuth2Client();
  let active = false, lastExport = 0, windowStart = 0, attempts = 0;
  const verify = verifyToken || (async (idToken, audience) => (await google.verifyIdToken({ idToken, audience, maxExpiry: 3900 })).getPayload());
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.get("Origin")) return res.status(403).json({ message: "Backup authorization failed." });
    const config = getSettings();
    if (!config) return res.status(503).json({ message: "Cloud backup is not configured." });
    const token = /^Bearer ([A-Za-z0-9_.-]{50,8192})$/.exec(req.get("Authorization") || "")?.[1];
    if (!token) return res.status(401).json({ message: "Backup authorization failed." });
    if (Date.now() - windowStart > 60000) { windowStart = Date.now(); attempts = 0; }
    if (++attempts > 20) return res.status(429).json({ message: "Retry later." });
    Promise.resolve(verify(token, config.audience)).then(payload => {
      if (!payload || payload.email_verified !== true || typeof payload.sub !== "string" ||
        payload.email?.toLowerCase() !== config.owner || payload.aud !== config.audience) return res.status(403).json({ message: "Backup authorization failed." });
      req.cloudBackupConfig = config; next();
    }).catch(() => res.status(401).json({ message: "Backup authorization failed." }));
  });
  router.get("/status", (req, res) => res.json({ status: "configured", keyFingerprint: req.cloudBackupConfig.fingerprint, format: "JWE-zip-v1" }));
  router.post("/export", async (req, res) => {
    if (active || Date.now() - lastExport < 60000) return res.status(429).json({ message: "Backup busy; retry later." });
    if (getStorage() !== "mongo") return res.status(503).json({ message: "Mongo-backed private storage is required." });
    active = true; lastExport = Date.now();
    try {
      const snapshot = await captureSnapshot({ client: getClient(), database: getDatabase() });
      const ciphertext = await encryptSnapshot(snapshot.zip, req.cloudBackupConfig.key);
      const bytes = Buffer.byteLength(ciphertext), digest = sha(ciphertext);
      res.json({ format: "JWE-zip-v1", fileName: "FreelanceChain-auto-" + snapshot.summary.createdAt.replace(/[:.]/g, "-") + ".zip.jwe",
        ciphertext, bytes, sha256: digest, keyFingerprint: req.cloudBackupConfig.fingerprint, summary: snapshot.summary });
    } catch (error) {
      const known = new Set(["collection_limit", "unsupported_collection", "snapshot_limit", "snapshot_isolation_unavailable", "local_uploads_unsupported", "attachment_integrity", "schema_changed"]);
      console.error("Cloud backup failed", JSON.stringify({ reason: known.has(error.backupCode) ? error.backupCode : "snapshot_failed" }));
      if (!res.headersSent) res.status(503).json({ message: "Backup did not complete. No valid archive was returned." });
    } finally { active = false; }
  });
  router.use((req, res) => res.status(404).json({ message: "Backup route not found." }));
  return router;
}
module.exports = { settings, capture, encrypt, createRouter, EXCLUDED, MAX_RAW, MAX_ZIP };
