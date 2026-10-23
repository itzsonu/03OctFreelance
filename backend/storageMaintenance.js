const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const Attachment = require("./models/Attachment");
const Usage = require("./models/StorageUsage");
const Cleanup = require("./models/StorageCleanup");
const { storageRoot } = require("./fileStorage");
const PrivateFile = require("./models/PrivateFile");
const Pool = require("./models/PrivateStoragePool");
const GRACE_MS = 24 * 60 * 60 * 1000;
const validKey = key => typeof key === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(key);
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
async function isReferenced(id) {
  const [project, message, dispute] = await Promise.all([
    require("./models/Project").exists({ $or: [{ "milestones.submissions.files": id }, { "amendments.before.milestones.submissions.files": id }, { "amendments.after.milestones.submissions.files": id }] }),
    require("./models/Message").exists({ attachments: id }),
    require("./models/Dispute").exists({ "history.attachments": id }),
  ]);
  return Boolean(project || message || dispute);
}
async function safeRoot() {
  const root = storageRoot();
  try {
    const stat = await fs.lstat(root);
    if (stat.isSymbolicLink() || !stat.isDirectory() || path.relative(root, await fs.realpath(root)) !== "") throw new Error("Private storage must be a real directory without linked parent paths");
    return root;
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function eligible(key, root, cutoff) {
  if (!validKey(key) || await Attachment.exists({ storageKey: key })) return null;
  const usage = await Usage.findOne({ "entries.key": key }).select("entries").lean();
  const entry = usage?.entries.find(item => item.key === key);
  if (entry && (!entry.createdAt || entry.createdAt.getTime() >= cutoff)) return null;
  let stat;
  try { if (root) stat = await fs.lstat(path.join(root, key)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || Math.max(stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs) >= cutoff)) return null;
  const blob = await PrivateFile.findById(key).select("size createdAt").lean();
  const pool = await Pool.findOne({ _id: "private-attachments", "entries.key": key }, { entries: { $elemMatch: { key } } }).lean();
  const sharedEntry = pool?.entries[0];
  if ((blob && (!blob.createdAt || blob.createdAt.getTime() >= cutoff)) || (sharedEntry && (!sharedEntry.createdAt || sharedEntry.createdAt.getTime() >= cutoff))) return null;
  if (!stat && !entry && !blob && !sharedEntry) return null;
  return { key, bytes: (stat?.size || 0) + (blob?.size || 0), usage, entry, hasFile: Boolean(stat), blob, sharedEntry };
}
async function preview(actor, now = Date.now()) {
  const root = await safeRoot();
  const cutoff = now - GRACE_MS;
  const keys = new Set();
  if (root) for (const file of await fs.readdir(root, { withFileTypes: true })) if (file.isFile() && validKey(file.name)) keys.add(file.name);
  // Reservations left by a crash before writing bytes also need safe retirement.
  for await (const row of Usage.find({ "entries.createdAt": { $lt: new Date(cutoff) } }).select("entries").cursor()) for (const entry of row.entries) if (entry.createdAt < cutoff) keys.add(entry.key);
  for await (const file of PrivateFile.find({ createdAt: { $lt: new Date(cutoff) } }).select("_id").cursor()) keys.add(file._id);
  for await (const pool of Pool.find({ "entries.createdAt": { $lt: new Date(cutoff) } }).select("entries").cursor()) for (const entry of pool.entries) if (entry.createdAt < cutoff) keys.add(entry.key);
  const candidates = []; let bytes = 0;
  for (const key of keys) {
    const candidate = await eligible(key, root, cutoff);
    if (candidate) { candidates.push(key); bytes += candidate.bytes; }
    if (candidates.length >= 500) break;
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const record = await Cleanup.create({ actor, tokenHash: digest(token), candidates, expiresAt: new Date(Date.now() + 15 * 60000) });
  return { token, previewId: record._id, candidates: candidates.length, bytes, graceHours: 24, batchLimit: 500, expiresAt: record.expiresAt, message: "Only abandoned files without any attachment record are eligible. All recorded project evidence is preserved." };
}
async function apply(actor, token, now = Date.now()) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw Object.assign(new Error("Generate a fresh cleanup preview"), { status: 400 });
  const root = await safeRoot();
  const record = await Cleanup.findOneAndUpdate({ actor, tokenHash: digest(token), expiresAt: { $gt: new Date() }, status: "preview" }, { $set: { status: "running", appliedAt: new Date() } }, { returnDocument: "after" }).select("+candidates");
  if (!record) throw Object.assign(new Error("Preview expired or was already used. Generate a fresh preview."), { status: 409 });
  try {
    for (const key of record.candidates) {
      const candidate = await eligible(key, root, now - GRACE_MS);
      if (!candidate) { record.skipped++; continue; }
      // Retire a reservation before removing bytes. A stalled uploader checks it after writing.
      if (candidate.entry) {
        if (await require("./attachmentStorage").release(candidate.usage._id, key, candidate.entry.size)) record.releasedReservations++;
      }
      // Recheck metadata immediately before touching any file. Grace protects active requests.
      if (await Attachment.exists({ storageKey: key })) { record.skipped++; continue; }
      if (candidate.hasFile) {
        const checkedRoot = await safeRoot();
        if (checkedRoot !== root) throw new Error("Storage directory changed during cleanup");
        try { await fs.unlink(path.join(root, key)); record.removedFiles++; }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      if (candidate.blob || candidate.sharedEntry) {
        if (await Attachment.exists({ storageKey: key })) { record.skipped++; continue; }
        await require("./mongoFileStorage").remove(key);
        if (candidate.blob) record.removedFiles++;
      }
    }
    record.status = "complete";
    await record.save();
  } catch (error) { record.status = "failed"; await record.save(); throw error; }
  return { removedFiles: record.removedFiles, releasedReservations: record.releasedReservations, skipped: record.skipped, message: "Cleanup finished. Recorded attachments and project history were preserved." };
}
module.exports = { isReferenced, preview, apply, GRACE_MS, safeRoot };
