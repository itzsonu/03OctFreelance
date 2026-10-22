const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.EVENT_EMAILS_ENABLED = "false";
process.env.UPLOAD_USER_QUOTA_MB = "1";
const User = require("./models/User");
const Project = require("./models/Project");
const Attachment = require("./models/Attachment");
const Usage = require("./models/StorageUsage");
const Request = require("./models/SupportRequest");
const Notification = require("./models/Notification");
const storage = require("./attachmentStorage");
const maintenance = require("./storageMaintenance");
const { testSession, authHeaders } = require("./testSession");
const app = require("./app");
test("shared storage limits, cautious cleanup and private support/deletion reviews", async t => {
  const database = `freelancechain_storage_support_test_${crypto.randomBytes(8).toString("hex")}`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fc-storage-support-"));
  process.env.PRIVATE_UPLOAD_DIR = directory;
  let server;
  try {
    await mongoose.connect(`${process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017"}/${database}`, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([User.init(), Attachment.init(), Usage.init(), Request.init()]);
    const password = "temporary-test-password"; const hash = await bcrypt.hash(password, 4);
    async function person(role, name) { const user = await User.create({ role, name, email: `${name}@example.test`, password: hash }); return { user, auth: await testSession(user) }; }
    const owner = await person("client", "owner"); const other = await person("client", "other"); const admin = await person("admin", "admin"); const admin2 = await person("admin", "admin2");
    const project = await Project.create({ client: owner.user._id, title: "Temporary storage project", budget: 100, deadline: "2035-12-31" });
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(method, route, actor, body, expected = 200) {
      const response = await fetch(base + route, { method, headers: { ...authHeaders(actor?.auth), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json(); assert.equal(response.status, expected, `${route}: ${JSON.stringify(data)}`); return data;
    }
    const file = size => ({ originalname: "evidence.txt", mimetype: "text/plain", size, buffer: Buffer.alloc(size, "x") });
    await t.test("simultaneous writers cannot bypass byte quotas; rollback releases once", async () => {
      const results = await Promise.allSettled([storage.saveAttachments(project, owner.user, [file(700000)]), storage.saveAttachments(project, owner.user, [file(700000)])]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(results.find(result => result.status === "rejected").reason.status, 413);
      const saved = results.find(result => result.status === "fulfilled").value;
      assert.equal((await storage.storageView(owner.user._id)).usedBytes, 700000);
      await storage.discardAttachments(saved); await storage.discardAttachments(saved);
      assert.equal((await storage.storageView(owner.user._id)).usedBytes, 0);
      await assert.rejects(storage.saveAttachments(project, owner.user, [{ ...file(5), size: 4 }]), error => error.status === 400);
      const row = await Usage.findById(owner.user._id); row.count = 1000; await row.save();
      await assert.rejects(storage.saveAttachments(project, owner.user, [file(5)]), error => error.status === 413);
      await Usage.updateOne({ _id: owner.user._id }, { $set: { count: 0 } });
    });
    await t.test("legacy uploads count toward quota; referenced evidence survives rollback", async () => {
      const key = crypto.randomUUID(); await fs.writeFile(path.join(directory, key), "legacy");
      const attachment = await Attachment.create({ project: project._id, uploader: other.user._id, storageKey: key, filename: "legacy.txt", mimeType: "text/plain", size: 6 });
      const view = await storage.storageView(other.user._id); assert.equal(view.usedBytes, 6); assert.equal(view.usedFiles, 1);
      project.milestones.push({ title: "Delivered", status: "submitted", submissions: [{ files: [attachment._id] }] }); await project.save();
      await storage.discardAttachments([attachment]);
      assert.ok(await Attachment.exists({ _id: attachment._id })); assert.equal(await fs.readFile(path.join(directory, key), "utf8"), "legacy");
    });
    await t.test("preview is read-only; apply rechecks records, age and token ownership", async () => {
      const old = crypto.randomUUID(); const protectLater = crypto.randomUUID(); const fresh = crypto.randomUUID(); const reservation = crypto.randomUUID();
      for (const key of [old, protectLater, fresh]) await fs.writeFile(path.join(directory, key), "orphan");
      const now = Date.now() + 48 * 60 * 60 * 1000;
      await fs.utimes(path.join(directory, fresh), new Date(now), new Date(now));
      await fs.writeFile(path.join(directory, "leave-me.txt"), "operator file");
      const expired = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await Usage.updateOne({ _id: owner.user._id }, { $inc: { bytes: 6, count: 1 }, $push: { entries: { key: reservation, size: 6, createdAt: expired } } });
      const preview = await maintenance.preview(admin.user._id, now);
      assert.equal(preview.candidates, 3);
      assert.equal(await fs.readFile(path.join(directory, old), "utf8"), "orphan");
      await assert.rejects(maintenance.apply(admin2.user._id, preview.token, now), error => error.status === 409);
      await Attachment.create({ project: project._id, uploader: other.user._id, storageKey: protectLater, filename: "retained.txt", mimeType: "text/plain", size: 6 });
      const result = await maintenance.apply(admin.user._id, preview.token, now);
      assert.equal(result.removedFiles, 1); assert.equal(result.releasedReservations, 1); assert.equal(result.skipped, 1);
      await assert.rejects(fs.stat(path.join(directory, old)), error => error.code === "ENOENT");
      for (const key of [protectLater, fresh, "leave-me.txt"]) assert.ok(await fs.stat(path.join(directory, key)));
      assert.equal((await storage.storageView(owner.user._id)).usedBytes, 0);
      await assert.rejects(maintenance.apply(admin.user._id, preview.token, now), error => error.status === 409);
      await call("POST", "/admin/storage/preview", owner, null, 403);
      await call("POST", "/admin/storage/cleanup", admin, { token: "bad-token" }, 400);
    });
    await t.test("guest requests need a secret tracking code; admin replies reach the owner only", async () => {
      const guest = await call("POST", "/support", null, { email: "guest@example.test", subject: "Cannot sign in", message: "Please help me recover access to my account." }, 201);
      assert.ok(guest.trackingCode); assert.ok(!guest.request.trackingHash);
      await call("POST", "/support/status", null, { trackingCode: guest.request._id }, 404);
      await call("GET", `/admin/support/${guest.request._id}`, owner, null, 403);
      const viewed = await call("GET", `/admin/support/${guest.request._id}`, admin);
      await call("POST", `/admin/support/${guest.request._id}`, admin, { version: viewed.request.version, status: "reviewing", response: "Please describe the sign-in error without sharing your password." });
      const tracked = await call("POST", "/support/status", null, { trackingCode: guest.trackingCode }); assert.equal(tracked.request.history.length, 1);
      const own = await call("POST", "/account/support", owner, { email: "spoofed@example.test", subject: "Project listing issue", message: "My project is missing from the public list." }, 201);
      assert.equal(own.request.email, owner.user.email);
      assert.equal((await call("GET", "/account/support?page=1", owner)).total, 1);
      assert.equal((await call("GET", "/account/support?page=1", other)).total, 0);
      await call("GET", "/account/support", null, null, 401);
      await call("POST", `/admin/support/${own.request._id}`, admin, { version: 0, status: "closed", response: "The listing review is complete. Please check your dashboard." });
      assert.ok(await Notification.exists({ user: owner.user._id, type: "support" }));
      await call("POST", `/admin/support/${own.request._id}`, admin, { version: 0, status: "open", response: "This is a stale update and must not be accepted." }, 409);
    });
    await t.test("deletion requires password, deduplicates races and preserves project records", async () => {
      await call("POST", "/account/deletion-request", owner, { acknowledged: true, currentPassword: "wrong-password" }, 400);
      const body = { currentPassword: password, acknowledged: true };
      const responses = await Promise.all([fetch(base + "/account/deletion-request", { method: "POST", headers: { ...authHeaders(owner.auth), "Content-Type": "application/json" }, body: JSON.stringify(body) }), fetch(base + "/account/deletion-request", { method: "POST", headers: { ...authHeaders(owner.auth), "Content-Type": "application/json" }, body: JSON.stringify(body) })]);
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
      const row = (await call("GET", "/account/deletion-request", owner)).request;
      await call("POST", `/account/deletion-request/${row._id}/cancel`, other, null, 409);
      await call("POST", `/admin/support/${row._id}`, admin, { version: row.version, status: "closed", response: "Review closed pending a separately agreed data-handling plan. No account records were erased." });
      assert.ok(await User.exists({ _id: owner.user._id })); assert.ok(await Project.exists({ _id: project._id }));
      assert.equal((await call("GET", "/account/deletion-request", other)).request, null);
      const next = await call("POST", "/account/deletion-request", other, body, 201);
      await call("POST", `/account/deletion-request/${next.request._id}/cancel`, other);
      await call("POST", `/admin/support/${next.request._id}`, admin, { version: 1, status: "reviewing", response: "Cancelled reviews must not be reopened by an administrator." }, 409);
      assert.equal((await call("GET", "/admin/support?kind=deletion&status=all&page=1", admin)).total, 2);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    // Only this mkdtemp-created test directory is removed, never configured app storage.
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith("fc-storage-support-")) await fs.rm(directory, { recursive: true, force: true });
  }
});
