const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const http = require("node:http");
const mongoose = require("mongoose");
const { MongoClient, BSON } = mongoose.mongo;
const recovery = require("./recovery");
test("offline snapshots preserve BSON, indexes and private files while protecting existing targets", async () => {
  const id = crypto.randomBytes(6).toString("hex");
  const sourceName = `freelancechain_recovery_test_${id}`; const targetName = `freelancechain_restore_test_${id}`;
  const base = process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017";
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fc-recovery-test-"));
  const uploads = path.join(directory, "original-uploads"); await fs.mkdir(uploads);
  const destination = path.join(directory, "snapshot"); const restoredUploads = path.join(directory, "restored-uploads");
  const client = new MongoClient(base); let server;
  try {
    await client.connect(); const db = client.db(sourceName);
    const key = crypto.randomUUID(); await fs.writeFile(path.join(uploads, key), "private delivery evidence");
    const userId = new BSON.ObjectId(); const stamp = new Date("2026-10-22T00:00:00Z");
    await db.collection("users").insertOne({ _id: userId, name: "Fictional recovery example", tokenVersion: 3, passwordResetTokenHash: "invalid-after-restore", emailChangeTokenHash: "also-invalid" });
    await db.collection("attachments").insertOne({ storageKey: key, uploader: userId, size: 25 });
    await db.collection("records").insertOne({ when: stamp, user: userId, amount: BSON.Decimal128.fromString("123.45"), long: BSON.Long.fromString("9223372036854775806"), binary: new BSON.Binary(Buffer.from([0, 1, 255])) });
    await db.collection("records").createIndex({ user: 1 }, { name: "unique_user", unique: true, partialFilterExpression: { user: { $exists: true } } });
    await db.collection("sessions").insertOne({ tokenHash: "must-not-restore" });
    await db.collection("ratebuckets").insertOne({ count: 10 });
    await db.collection("notifications").insertOne({ emailStatus: "sending" });
    server = http.createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end('{"status":"alive"}'); }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const appUrl = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(recovery.backup({ uri: `${base}/${sourceName}`, uploads, destination, offlineConfirmed: true, appUrl }), /still answers/);
    await new Promise(resolve => server.close(resolve)); server = null;
    const backup = await recovery.backup({ uri: `${base}/${sourceName}`, uploads, destination, offlineConfirmed: true, appUrl });
    assert.equal(backup.files, 1); const { manifest } = await recovery.verify(destination);
    assert.ok(!manifest.collections.some(file => ["sessions", "ratebuckets"].includes(file.collection)));
    const options = { uri: `${base}/${targetName}`, uploads: restoredUploads, source: destination, offlineConfirmed: true, appUrl };
    assert.equal((await recovery.restore(options)).preview, true);
    assert.equal((await client.db(targetName).listCollections().toArray()).length, 0);
    await assert.rejects(recovery.restore({ ...options, uri: `${base}/${sourceName}`, apply: true }), /fresh database/);
    await recovery.restore({ ...options, apply: true });
    const target = client.db(targetName); const doc = await target.collection("records").findOne({});
    assert.ok(doc.when instanceof Date); assert.equal(doc.when.toISOString(), stamp.toISOString());
    assert.equal(String(doc.user), String(userId)); assert.equal(String(doc.amount), "123.45"); assert.equal(String(doc.long), "9223372036854775806");
    assert.deepEqual([...doc.binary.buffer], [0, 1, 255]);
    assert.equal((await target.collection("records").indexes()).find(index => index.name === "unique_user").unique, true);
    const restoredUser = await target.collection("users").findOne({}); assert.equal(restoredUser.tokenVersion, 4); assert.equal(restoredUser.passwordResetTokenHash, undefined);
    assert.equal(await target.collection("sessions").countDocuments(), 0); assert.equal((await target.collection("notifications").findOne({})).emailStatus, "skipped");
    assert.equal(await fs.readFile(path.join(restoredUploads, key), "utf8"), "private delivery evidence");
    await assert.rejects(recovery.restore({ ...options, apply: true }), /must not already exist/);
    await fs.appendFile(path.join(destination, "uploads", key), "corrupt"); await assert.rejects(recovery.verify(destination), /integrity/);
    assert.equal(await db.collection("users").countDocuments(), 1);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const name of [sourceName, targetName]) await client.db(name).dropDatabase(); await client.close();
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith("fc-recovery-test-")) await fs.rm(directory, { recursive: true, force: true });
  }
});
test("production config and readiness reject invalid origins, database loss and shutdown", async () => {
  const old = { ...process.env }; let server; const healthDatabase = "freelancechain_health_test_" + crypto.randomBytes(6).toString("hex");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fc-health-test-"));
  try {
    process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex"); process.env.MONGO_URI = "mongodb://127.0.0.1:27017/" + healthDatabase;
    process.env.NODE_ENV = "production"; process.env.APP_ORIGIN = "http://localhost:5000";
    assert.throws(() => require("./deployment").config(), /HTTPS/);
    process.env.APP_ORIGIN = "https://example.test"; delete process.env.RESET_DELIVERY; require("./deployment").config();
    process.env.PRIVATE_UPLOAD_DIR = directory;
    const app = require("./app"); server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(origin + "/api/health/live")).status, 200);
    assert.equal((await fetch(origin + "/api/health/ready")).status, 503);
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await require("./scripts/checkHealth").checkHealth(origin);
    app.locals.draining = true; assert.equal((await fetch(origin + "/api/health/live")).status, 503);
    await assert.rejects(require("./scripts/checkHealth").checkHealth(origin));
    app.locals.draining = false;
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (mongoose.connection.name === healthDatabase) await mongoose.connection.dropDatabase();
    await mongoose.disconnect(); process.env = old;
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith("fc-health-test-")) await fs.rm(directory, { recursive: true, force: true });
  }
});
