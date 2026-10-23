const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { testSession, authHeaders, responseAuth } = require("./testSession");
const oldEnv = { ...process.env };
process.env.NODE_ENV = "production";
process.env.APP_ORIGIN = "https://fc-cloud.example.test";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.FC_PROXY_SECRET = crypto.randomBytes(32).toString("hex");
process.env.PRIVATE_UPLOAD_BACKEND = "mongo";
process.env.UPLOAD_USER_QUOTA_MB = "2";
process.env.UPLOAD_SHARED_QUOTA_MB = "1";
process.env.EVENT_EMAILS_ENABLED = "false";
const User = require("./models/User");
const Project = require("./models/Project");
const Application = require("./models/Application");
const Message = require("./models/Message");
const Attachment = require("./models/Attachment");
const PrivateFile = require("./models/PrivateFile");
const Pool = require("./models/PrivateStoragePool");
const storage = require("./fileStorage");
const mongo = require("./mongoFileStorage");
const attachments = require("./attachmentStorage");
const maintenance = require("./storageMaintenance");
const recovery = require("./recovery");
const app = require("./app");

test("cloud cookie proxy and durable private Mongo attachments", async t => {
  const suffix = crypto.randomBytes(6).toString("hex"), database = "freelancechain_cloud_test_" + suffix;
  const restoreDatabase = "freelancechain_restore_cloud_" + suffix;
  const baseMongo = process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017";
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fc-cloud-test-"));
  process.env.PRIVATE_UPLOAD_DIR = path.join(directory, "local");
  process.env.MONGO_URI = baseMongo + "/" + database;
  let backend, proxy, backendPort, proxyBase;
  async function startBackend() {
    backend = app.listen(0, "127.0.0.1"); await new Promise(resolve => backend.once("listening", resolve)); backendPort = backend.address().port;
  }
  async function stopBackend() { if (backend) { require("./liveUpdates").disconnectAll(); backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve)); backend = null; } }
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Attachment.init(), require("./models/StorageUsage").init(), require("./models/Session").init(), require("./models/RateBucket").init()]);
    await mongo.init(); await startBackend();
    proxy = http.createServer((req, res) => {
      const forward = http.request({ hostname: "127.0.0.1", port: backendPort, path: req.url, method: req.method, headers: { ...req.headers, host: "127.0.0.1:" + backendPort, "x-fc-origin-secret": process.env.FC_PROXY_SECRET, "x-real-ip": "203.0.113.25" } }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      forward.on("error", () => { res.writeHead(502); res.end("Backend stopped"); }); req.pipe(forward);
    }).listen(0, "127.0.0.1");
    await new Promise(resolve => proxy.once("listening", resolve)); proxyBase = "http://127.0.0.1:" + proxy.address().port + "/api";
    const password = "DisposableCloudDemo-2026!", hash = await bcrypt.hash(password, 4);
    async function person(name, role) { const user = await User.create({ name, role, email: name + "@example.test", password: hash }); return { user, auth: await testSession(user) }; }
    const client = await person("client", "client"), worker = await person("worker", "freelancer"), stranger = await person("stranger", "client"), admin = await person("admin", "admin");
    const project = await Project.create({ client: client.user._id, freelancer: worker.user._id, title: "Cloud demo", budget: 1000, deadline: "2035-12-31", status: "In Progress", milestones: [{ title: "Deliver", status: "active", payment: 1000 }] });
    const application = await Application.create({ project: project._id, freelancer: worker.user._id, proposal: "Fictional agreed delivery", proposedPrice: 1000, deliveryEstimateDays: 7, status: "ACCEPTED" });
    async function call(method, route, actor, body, status = 200) {
      const multipart = body instanceof FormData;
      const response = await fetch(proxyBase + route, { method, headers: { ...authHeaders(actor?.auth), Origin: process.env.APP_ORIGIN, ...(!multipart && body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) });
      const data = await response.json(); assert.equal(response.status, status, route + ": " + JSON.stringify(data)); return { response, data };
    }
    await t.test("Render startup rejects ephemeral uploads and missing proxy authentication", () => {
      process.env.RENDER = "true"; require("./deployment").config();
      process.env.PRIVATE_UPLOAD_BACKEND = "local"; assert.throws(() => require("./deployment").config(), /Render requires/);
      process.env.PRIVATE_UPLOAD_BACKEND = "mongo"; const secret = process.env.FC_PROXY_SECRET; delete process.env.FC_PROXY_SECRET;
      assert.throws(() => require("./deployment").config(), /Render requires/); process.env.FC_PROXY_SECRET = secret; delete process.env.RENDER;
    });
    let fileId, fileKey;
    const bytes = Buffer.from("Private evidence survives a cloud restart.");
    await t.test("same-origin proxy preserves cookies/CSRF and rejects direct or spoofed requests", async () => {
      const login = await call("POST", "/auth/login", null, { email: client.user.email, password, role: "client" });
      const cookie = login.response.headers.get("set-cookie");
      assert.match(cookie, /__Host-fc_session=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/); assert.equal(/Domain=/i.test(cookie), false);
      client.auth = responseAuth(login.response, login.data);
      assert.equal((await call("GET", "/auth/session", client)).data.user.id, String(client.user._id));
      assert.equal(JSON.stringify(login.data).includes(process.env.FC_PROXY_SECRET), false); assert.equal(login.data.token, undefined);
      const direct = "http://127.0.0.1:" + backendPort + "/api";
      assert.equal((await fetch(direct + "/auth/session", { headers: { ...authHeaders(client.auth), "x-real-ip": "203.0.113.25", "x-forwarded-for": "203.0.113.25" } })).status, 403);
      assert.equal((await fetch(direct + "/auth/session", { headers: { ...authHeaders(client.auth), "x-fc-origin-secret": "x".repeat(64) } })).status, 403);
      assert.equal((await fetch(direct + "/health/ready")).status, 200);
      const denied = await fetch(proxyBase + "/messages/application/" + application._id, { method: "POST", headers: { ...authHeaders(client.auth), "X-CSRF-Token": "wrong", "Content-Type": "application/json", Origin: process.env.APP_ORIGIN }, body: "{}" });
      assert.equal(denied.status, 403);
    });
    await t.test("uploads retain content checks and participant-only downloads", async () => {
      const form = new FormData(); form.set("body", "Review this private delivery."); form.append("files", new Blob([bytes], { type: "text/plain" }), "delivery.txt");
      const posted = await call("POST", "/messages/application/" + application._id, client, form, 201);
      assert.deepEqual(Object.keys(posted.data.attachments[0]).sort(), ["filename", "id", "mimeType", "size"]);
      fileId = posted.data.attachments[0].id;
      const metadata = await Attachment.findById(fileId).select("+storageKey +storageBackend").lean(); fileKey = metadata.storageKey;
      assert.equal(metadata.storageBackend, "mongo"); assert.equal(await PrivateFile.countDocuments(), 1);
      await assert.rejects(fs.stat(process.env.PRIVATE_UPLOAD_DIR), error => error.code === "ENOENT");
      const route = "/workrooms/projects/" + project._id + "/files/" + fileId;
      for (const actor of [client, worker]) {
        const response = await fetch(proxyBase + route, { headers: authHeaders(actor.auth) }); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      }
      assert.equal((await fetch(proxyBase + route, { headers: authHeaders(stranger.auth) })).status, 403);
      assert.equal((await fetch(proxyBase + route)).status, 401);
      const dispute = await require("./models/Dispute").create({ project: project._id, history: [{ author: client.user._id, action: "opened", text: "Review this evidence.", attachments: [fileId] }] });
      const caseRoute = "/admin/cases/" + dispute._id + "/files/" + fileId;
      const caseFile = await fetch(proxyBase + caseRoute, { headers: authHeaders(admin.auth) }); assert.equal(caseFile.status, 200); assert.deepEqual(Buffer.from(await caseFile.arrayBuffer()), bytes);
      assert.equal((await fetch(proxyBase + caseRoute, { headers: authHeaders(client.auth) })).status, 403);
      const invalid = new FormData(); invalid.append("files", new Blob(["not a PDF"], { type: "application/pdf" }), "bad.pdf");
      await call("POST", "/messages/application/" + application._id, client, invalid, 400);
    });
    await t.test("sessions and private bytes persist across a backend/database reconnect", async () => {
      await stopBackend(); await mongoose.disconnect();
      await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 }); await startBackend();
      assert.equal((await call("GET", "/auth/session", client)).data.user.id, String(client.user._id));
      const response = await fetch(proxyBase + "/workrooms/projects/" + project._id + "/files/" + fileId, { headers: authHeaders(client.auth) });
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    });
    await t.test("shared reservations stop concurrent users bypassing the cloud capacity limit", async () => {
      const baseline = (await mongo.view()).usedBytes;
      const file = { originalname: "large.txt", mimetype: "text/plain", size: 700000, buffer: Buffer.alloc(700000, "a") };
      const results = await Promise.allSettled([attachments.saveAttachments(project, worker.user, [file]), attachments.saveAttachments(project, worker.user, [file])]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(results.find(result => result.status === "rejected").reason.status, 413);
      const saved = results.find(result => result.status === "fulfilled").value;
      await attachments.discardAttachments(saved); await attachments.discardAttachments(saved);
      assert.equal((await mongo.view()).usedBytes, baseline); assert.equal((await attachments.storageView(worker.user._id)).usedBytes, 0);
    });
    await t.test("cleanup retires only abandoned cloud files and preserves recorded evidence", async () => {
      const key = crypto.randomUUID(), reservation = crypto.randomUUID(), old = new Date(Date.now() - 48 * 3600000);
      await mongo.store(key, Buffer.from("abandoned"));
      await PrivateFile.collection.updateOne({ _id: key }, { $set: { createdAt: old } });
      await Pool.updateOne({ _id: "private-attachments", "entries.key": key }, { $set: { "entries.$.createdAt": old } });
      await Pool.updateOne({ _id: "private-attachments" }, { $inc: { bytes: 7, count: 1 }, $push: { entries: { key: reservation, size: 7, createdAt: old } } });
      const preview = await maintenance.preview(admin.user._id);
      assert.equal(preview.candidates, 2);
      const result = await maintenance.apply(admin.user._id, preview.token); assert.equal(result.removedFiles, 1);
      assert.ok(await Attachment.exists({ _id: fileId })); assert.deepEqual(await mongo.read(fileKey), bytes); assert.equal((await mongo.view()).usedBytes, bytes.length);
    });
    await t.test("offline migration previews, verifies copies, resumes and preserves original files", async () => {
      process.env.PRIVATE_UPLOAD_BACKEND = "local";
      const file = { originalname: "legacy.txt", mimetype: "text/plain", size: 6, buffer: Buffer.from("legacy") };
      const [legacy] = await attachments.saveAttachments(project, client.user, [file]);
      await Message.create({ application: application._id, sender: client.user._id, body: "Legacy evidence", attachments: [legacy._id] });
      process.env.PRIVATE_UPLOAD_BACKEND = "mongo";
      const { migrate } = require("./scripts/migratePrivateUploads");
      assert.equal((await migrate()).files, 1); assert.equal(await PrivateFile.exists({ _id: legacy.storageKey }), null);
      await assert.rejects(migrate({ apply: true }), /Stop every/);
      await assert.rejects(migrate({ apply: true, offlineConfirmed: true, appUrl: "http://127.0.0.1:" + backendPort }), /still answers/);
      const stopped = "http://127.0.0.1:" + backendPort; await stopBackend();
      // A previous interrupted run copied bytes but did not update metadata.
      await mongo.store(legacy.storageKey, file.buffer); assert.equal((await migrate()).reused, 1);
      assert.equal((await migrate({ apply: true, offlineConfirmed: true, appUrl: stopped })).migrated, 1);
      const metadata = await Attachment.findById(legacy._id).select("+storageKey +storageBackend").lean();
      assert.equal(metadata.storageKey, legacy.storageKey); assert.equal(metadata.storageBackend, "mongo");
      assert.deepEqual(await fs.readFile(path.join(process.env.PRIVATE_UPLOAD_DIR, legacy.storageKey)), file.buffer);
      assert.deepEqual(await mongo.read(legacy.storageKey), file.buffer);
      assert.equal((await migrate()).files, 0);
      await startBackend();
      const response = await fetch(proxyBase + "/workrooms/projects/" + project._id + "/files/" + legacy._id, { headers: authHeaders(client.auth) }); assert.deepEqual(Buffer.from(await response.arrayBuffer()), file.buffer);
    });
    await t.test("offline snapshots restore Mongo bytes without needing a local upload directory", async () => {
      const stopped = "http://127.0.0.1:" + backendPort; await stopBackend();
      const snapshot = path.join(directory, "snapshot");
      await recovery.backup({ uri: process.env.MONGO_URI, uploads: path.join(directory, "no-local-files"), destination: snapshot, offlineConfirmed: true, appUrl: stopped });
      await recovery.verify(snapshot);
      await recovery.restore({ uri: baseMongo + "/" + restoreDatabase, uploads: path.join(directory, "restored"), source: snapshot, apply: true, offlineConfirmed: true, appUrl: stopped });
      const target = mongoose.connection.client.db(restoreDatabase);
      assert.deepEqual(Buffer.from((await target.collection("privatefiles").findOne({ _id: fileKey })).data.buffer), bytes);
      assert.equal((await target.collection("attachments").findOne({ _id: new mongoose.Types.ObjectId(fileId) })).storageBackend, "mongo");
      assert.equal(await target.collection("sessions").countDocuments(), 0);
    });
  } finally {
    await stopBackend();
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
    if (mongoose.connection.readyState === 1) { await mongoose.connection.client.db(restoreDatabase).dropDatabase(); if (mongoose.connection.name === database) await mongoose.connection.dropDatabase(); }
    await mongoose.disconnect(); process.env = oldEnv;
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith("fc-cloud-test-")) await fs.rm(directory, { recursive: true, force: true });
  }
});
