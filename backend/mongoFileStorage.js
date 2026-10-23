const crypto = require("node:crypto");
const PrivateFile = require("./models/PrivateFile");
const Pool = require("./models/PrivateStoragePool");
const POOL = "private-attachments";
function limits() {
  const mb = Number(process.env.UPLOAD_SHARED_QUOTA_MB || 100);
  if (!Number.isSafeInteger(mb) || mb < 1 || mb > 10000) throw new Error("UPLOAD_SHARED_QUOTA_MB must be from 1 to 10000");
  return { maxBytes: mb * 1024 * 1024, maxFiles: 10000 };
}
async function init() {
  await Promise.all([PrivateFile.init(), Pool.init()]);
  if (await Pool.exists({ _id: POOL })) return;
  const files = await PrivateFile.find().select("size createdAt").lean();
  if (files.length > limits().maxFiles) throw new Error("Private storage ledger requires operator review");
  try { await Pool.create({ _id: POOL, bytes: files.reduce((sum, file) => sum + file.size, 0), count: files.length, entries: files.map(file => ({ key: file._id, size: file.size, createdAt: file.createdAt })) }); }
  catch (error) { if (error.code !== 11000) throw error; }
}
async function release(key) {
  const row = await Pool.findOne({ _id: POOL, "entries.key": key }, { entries: { $elemMatch: { key } } }).lean();
  const entry = row?.entries[0]; if (!entry) return false;
  const result = await Pool.updateOne({ _id: POOL, "entries.key": key }, { $pull: { entries: { key } }, $inc: { bytes: -entry.size, count: -1 } });
  return result.modifiedCount === 1;
}
async function store(key, bytes) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(key) || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Invalid private file bytes or key");
  await init();
  const quota = limits();
  const reservation = await Pool.updateOne({ _id: POOL, bytes: { $lte: quota.maxBytes - bytes.length }, count: { $lt: quota.maxFiles }, "entries.key": { $ne: key } },
    { $inc: { bytes: bytes.length, count: 1 }, $push: { entries: { key, size: bytes.length, createdAt: new Date() } } });
  if (!reservation.modifiedCount) throw Object.assign(new Error("Shared attachment capacity is reached. Contact support before uploading more files."), { status: 413 });
  try { await PrivateFile.create({ _id: key, size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), data: bytes }); }
  catch (error) {
    // An uncertain write might already have committed. Retain its reservation for safe review.
    if (!await PrivateFile.exists({ _id: key })) await release(key);
    throw error;
  }
}
async function read(key) {
  const file = await PrivateFile.findById(key).select("+data"); if (!file) return null;
  const bytes = Buffer.from(file.data);
  if (bytes.length !== file.size || crypto.createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new Error("Private file integrity check failed");
  return bytes;
}
async function remove(key) { await PrivateFile.deleteOne({ _id: key }); await release(key); }
async function check() {
  if (!await Pool.exists({ _id: POOL })) throw new Error("Private storage is not initialized");
}
async function view() {
  const row = await Pool.findById(POOL).select("bytes count").lean();
  return { backend: "mongo", usedBytes: row?.bytes || 0, usedFiles: row?.count || 0, ...limits() };
}
module.exports = { init, check, store, read, remove, release, limits, view };
