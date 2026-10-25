const fs = require("node:fs/promises");
const streams = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");
const { createInterface } = require("node:readline");
const { MongoClient, BSON } = require("mongoose").mongo;
const { EJSON } = BSON;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const EXCLUDED = new Set(["sessions", "ratebuckets", "google_login_challenges", "_recovery_claim"]);
function inside(root, target) { const rel = path.relative(root, target); return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); }
function namedDatabase(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/[^/]+\/([^?/#]+)(?:\?|$)/.exec(uri || "");
  if (!match || !/^[A-Za-z0-9_-]+$/.test(match[1]) || ["admin", "local", "config"].includes(match[1])) throw new Error("Use a URI with an explicit application database name");
  return match[1];
}
async function noLinks(directory) {
  const resolved = path.resolve(directory); const info = await fs.lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || path.relative(resolved, await fs.realpath(resolved)) !== "") throw new Error("Use a real directory without linked parent paths");
  return resolved;
}
async function hash(file) { const digest = crypto.createHash("sha256"); for await (const chunk of streams.createReadStream(file)) digest.update(chunk); return digest.digest("hex"); }
async function descriptor(file, name) { return { name, size: (await fs.stat(file)).size, sha256: await hash(file) }; }
async function offline({ offlineConfirmed, appUrl }) {
  if (offlineConfirmed !== true) throw new Error("Stop every app instance, worker and external database writer, then supply --offline-confirmed");
  if (!appUrl) throw new Error("Supply --app-url for the stopped application");
  let response;
  try { response = await fetch(new URL("/api/health/live", appUrl), { signal: AbortSignal.timeout(3000), redirect: "error" }); }
  catch (error) { if (["ECONNREFUSED", "ENOTFOUND"].includes(error.cause?.code)) return; throw new Error("Could not prove the app is offline; check its address and stop it"); }
  // A reverse proxy may still answer 502/503 while the stopped app is unavailable.
  const body = await response.text();
  if ([502, 503].includes(response.status) && !/"status"\s*:/.test(body)) return;
  throw new Error("Application still answers requests. Stop it before taking an offline snapshot");
}
async function backup({ uri, uploads, destination, offlineConfirmed, appUrl }) {
  const sourceDatabase = namedDatabase(uri);
  await offline({ offlineConfirmed, appUrl });
  const uploadPath = path.resolve(uploads); let root = null;
  try { root = await noLinks(uploadPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const target = path.resolve(destination);
  if (inside(uploadPath, target) || inside(path.resolve(__dirname, "../public"), target) || inside(path.resolve(__dirname, "../build"), target)) throw new Error("Backup must be outside uploads and web-served directories");
  await fs.mkdir(target, { mode: 0o700 });
  await noLinks(target); await fs.mkdir(path.join(target, "uploads"), { mode: 0o700 });
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  const manifest = { format: "freelancechain-offline-ejson", version: 1, sourceDatabase, createdAt: new Date().toISOString(), excludedCollections: [...EXCLUDED], collections: [], uploads: [] };
  try {
    await client.connect(); const db = client.db();
    const collections = await db.listCollections().toArray();
    for (const collection of collections.sort((a, b) => a.name.localeCompare(b.name))) {
      if (EXCLUDED.has(collection.name)) continue;
      if (collection.type !== "collection" || collection.options?.timeseries || collection.name.startsWith("system.")) throw new Error("This tool supports ordinary application collections only. Use managed snapshots for other database features.");
      const name = `collection-${String(manifest.collections.length).padStart(4, "0")}.jsonl.gz`; let count = 0;
      const cursor = db.collection(collection.name).find({}, { promoteValues: false, promoteLongs: false });
      async function* lines() { for await (const doc of cursor) { count++; yield EJSON.stringify(doc, null, 0, { relaxed: false }) + "\n"; } }
      await pipeline(lines(), zlib.createGzip(), streams.createWriteStream(path.join(target, name), { flags: "wx", mode: 0o600 }));
      const indexes = await db.collection(collection.name).listIndexes().toArray();
      manifest.collections.push({ ...await descriptor(path.join(target, name), name), collection: collection.name, count, metadata: EJSON.stringify({ options: collection.options || {}, indexes }, null, 0, { relaxed: false }) });
    }
    for (const file of root ? await fs.readdir(root, { withFileTypes: true }) : []) {
      if (file.isSymbolicLink() || file.isDirectory()) throw new Error("Linked or nested private upload content requires manual investigation");
      if (!UUID.test(file.name)) continue;
      await fs.copyFile(path.join(root, file.name), path.join(target, "uploads", file.name), streams.constants.COPYFILE_EXCL);
      await fs.chmod(path.join(target, "uploads", file.name), 0o600);
      manifest.uploads.push(await descriptor(path.join(target, "uploads", file.name), file.name));
    }
    const keys = new Set(manifest.uploads.map(file => file.name));
    for await (const attachment of db.collection("attachments").find({}, { projection: { storageKey: 1, storageBackend: 1, size: 1 } })) {
      if (attachment.storageBackend === "mongo") {
        const file = await db.collection("privatefiles").findOne({ _id: attachment.storageKey });
        const data = file?.data?.buffer;
        if (!file || !data || data.length !== attachment.size || crypto.createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error("A recorded MongoDB attachment is missing or corrupt. Recover it before declaring a complete snapshot.");
      } else if (!keys.has(attachment.storageKey)) throw new Error("A recorded attachment is missing bytes. Recover it before declaring a complete snapshot.");
    }
    await fs.writeFile(path.join(target, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
    return { collections: manifest.collections.length, files: manifest.uploads.length, destination: target };
  } finally { await client.close(); }
}
async function verify(source) {
  const root = await noLinks(source); const manifestPath = path.join(root, "manifest.json");
  if ((await fs.lstat(manifestPath)).isSymbolicLink()) throw new Error("Linked manifests are not accepted");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.version !== 1 || manifest.format !== "freelancechain-offline-ejson" || !Array.isArray(manifest.collections) || !Array.isArray(manifest.uploads)) throw new Error("Unsupported or incomplete snapshot");
  const names = new Set(); const collections = new Set();
  for (const file of [...manifest.collections, ...manifest.uploads]) {
    const upload = UUID.test(file.name);
    if (!upload && !/^collection-\d{4,}\.jsonl\.gz$/.test(file.name)) throw new Error("Invalid snapshot filename");
    if (names.has(file.name)) throw new Error("Duplicate snapshot filename"); names.add(file.name);
    if (!upload) {
      if (typeof file.collection !== "string" || !file.collection || file.collection.includes("\0") || file.collection.startsWith("system.") || EXCLUDED.has(file.collection) || collections.has(file.collection)) throw new Error("Invalid collection in snapshot");
      collections.add(file.collection);
      if (!Number.isSafeInteger(file.count) || file.count < 0) throw new Error("Invalid document count");
    }
    const directory = upload ? await noLinks(path.join(root, "uploads")) : root;
    const checked = path.join(directory, file.name); const stat = await fs.lstat(checked);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size || await hash(checked) !== file.sha256) throw new Error("Snapshot integrity check failed");
  }
  return { root, manifest };
}
async function restore({ uri, uploads, source, apply = false, offlineConfirmed, appUrl }) {
  const database = namedDatabase(uri);
  if (!/^freelancechain_restore_[a-zA-Z0-9_-]+$/.test(database)) throw new Error("Restore only to a fresh database named freelancechain_restore_<name>");
  const { root, manifest } = await verify(source);
  if (database === manifest.sourceDatabase) throw new Error("Restore target must differ from the source database");
  const target = path.resolve(uploads);
  if (inside(root, target) || inside(path.resolve(__dirname, "../public"), target) || inside(path.resolve(__dirname, "../build"), target)) throw new Error("Restore uploads must use a separate private directory");
  try { await fs.lstat(target); throw new Error("Restore uploads directory must not already exist"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  await noLinks(path.dirname(target));
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect(); const db = client.db();
    if ((await db.listCollections().toArray()).length) throw new Error("Restore database must be empty. No existing collections will be overwritten.");
    if (!apply) return { preview: true, database, collections: manifest.collections.length, files: manifest.uploads.length, uploads: target };
    await offline({ offlineConfirmed, appUrl });
    await fs.mkdir(target, { mode: 0o700 });
    // Atomic ownership claim also prevents concurrent restore attempts from interleaving.
    await db.createCollection("_recovery_claim");
    for (const file of manifest.uploads) { await fs.copyFile(path.join(root, "uploads", file.name), path.join(target, file.name), streams.constants.COPYFILE_EXCL); await fs.chmod(path.join(target, file.name), 0o600); }
    for (const file of manifest.collections) {
      const metadata = EJSON.parse(file.metadata, { relaxed: false });
      await db.createCollection(file.collection, metadata.options); let count = 0; let batch = [];
      const input = streams.createReadStream(path.join(root, file.name)); const gunzip = zlib.createGunzip();
      input.on("error", error => gunzip.destroy(error)); input.pipe(gunzip);
      const lines = createInterface({ input: gunzip, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line) continue; batch.push(EJSON.parse(line, { relaxed: false })); count++;
          if (batch.length >= 100) { await db.collection(file.collection).insertMany(batch); batch = []; }
        }
        if (batch.length) await db.collection(file.collection).insertMany(batch);
      } finally { lines.close(); input.destroy(); gunzip.destroy(); }
      if (count !== file.count) throw new Error("Restored document count differs from manifest");
      const indexes = metadata.indexes.filter(index => index.name !== "_id_").map(({ v, ns, ...index }) => index);
      if (indexes.length) await db.collection(file.collection).createIndexes(indexes);
    }
    // Old recovery links and sign-ins must never regain validity after a restore.
    await db.collection("users").updateMany({}, { $inc: { tokenVersion: 1 }, $unset: { ...require("./accountSecurity").resetFields, ...require("./accountSecurity").emailChangeFields, ...require("./accountSecurity").verificationFields } });
    await db.collection("notifications").updateMany({ emailStatus: { $in: ["pending", "sending"] } }, { $set: { emailStatus: "skipped" }, $unset: { emailLeaseUntil: 1 } });
    await db.collection("_recovery_claim").updateOne({}, { $set: { complete: true, restoredAt: new Date() } }, { upsert: true });
    return { restored: true, database, files: manifest.uploads.length, uploads: target };
  } finally { await client.close(); }
}
module.exports = { backup, restore, verify, offline, namedDatabase };
