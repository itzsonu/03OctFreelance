const crypto = require("node:crypto");
const Attachment = require("./models/Attachment");
const Usage = require("./models/StorageUsage");
const { validateFile, storeFile, removeFile, MAX_FILE_SIZE, fileMetadata, storageBackend } = require("./fileStorage");
const fail = (status, message) => Object.assign(new Error(message), { status });
function limits() {
  const value = process.env.UPLOAD_USER_QUOTA_MB === undefined ? (storageBackend() === "mongo" ? 20 : 500) : Number(process.env.UPLOAD_USER_QUOTA_MB);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000) throw new Error("UPLOAD_USER_QUOTA_MB must be an integer from 1 to 10000");
  return { maxBytes: value * 1024 * 1024, maxFiles: 1000, maxFileBytes: MAX_FILE_SIZE, filesPerRequest: 3 };
}
async function usage(userId) {
  let row = await Usage.findById(userId).lean();
  if (!row) {
    // Include pre-existing files once. All new writers reserve before creating metadata.
    const files = await Attachment.find({ uploader: userId }).select("+storageKey size createdAt").lean();
    try { await Usage.create({ _id: userId, bytes: files.reduce((sum, file) => sum + file.size, 0), count: files.length, entries: files.map(file => ({ key: file.storageKey, size: file.size, createdAt: file.createdAt })) }); }
    catch (error) { if (error.code !== 11000) throw error; }
    row = await Usage.findById(userId).lean();
  }
  return row;
}
async function storageView(userId) {
  const row = await usage(userId);
  return { usedBytes: row.bytes, usedFiles: row.count, ...limits() };
}
async function release(userId, key, size) {
  // Presence condition prevents two retries decrementing the same reservation.
  const result = await Usage.updateOne({ _id: userId, "entries.key": key }, { $pull: { entries: { key } }, $inc: { bytes: -size, count: -1 } });
  return result.modifiedCount === 1;
}
async function discardAttachments(items) {
  for (const item of items) {
    // Caller may have received an uncertain database-write result. Never remove referenced evidence.
    if (await require("./storageMaintenance").isReferenced(item._id)) continue;
    await removeFile(item.storageKey, item.storageBackend || "local");
    await Attachment.deleteOne({ _id: item._id });
    await release(item.uploader, item.storageKey, item.size);
  }
}
async function saveAttachments(project, user, files = []) {
  if (!files.length) return [];
  if (files.length > 3 || files.some(file => !validateFile(file))) throw fail(400, "Use up to 3 valid PDF, text, CSV, PNG, JPEG or WebP files, at most 10 MB each");
  await usage(user._id);
  const entries = files.map(file => ({ key: crypto.randomUUID(), size: file.buffer.length, createdAt: new Date() }));
  const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const quota = limits();
  const reserved = await Usage.findOneAndUpdate({ _id: user._id, bytes: { $lte: quota.maxBytes - bytes }, count: { $lte: quota.maxFiles - files.length } }, { $inc: { bytes, count: files.length }, $push: { entries: { $each: entries } } });
  if (!reserved) throw fail(413, "Your attachment storage limit is reached. Check storage in Account settings or contact support.");
  const saved = [];
  let current = -1;
  try {
    for (let index = 0; index < files.length; index++) {
      current = index;
      const stored = fileMetadata(files[index], entries[index].key);
      // Metadata comes first: cleanup can never mistake a paused file write for an orphan.
      saved.push(await Attachment.create({ project: project._id, uploader: user._id, ...stored }));
      await storeFile(files[index], entries[index].key);
      // An old abandoned reservation may have been retired by maintenance while this process paused.
      if (!await Usage.exists({ _id: user._id, "entries.key": stored.storageKey })) throw fail(409, "Upload expired. Please attach the files again.");
    }
    return saved;
  } catch (error) {
    // Metadata with an uncertain create result is retained for review, not blindly erased.
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (await Attachment.exists({ storageKey: entry.key })) continue;
      if (index <= current) await removeFile(entry.key);
      await release(user._id, entry.key, entry.size);
    }
    await discardAttachments(saved);
    throw error;
  }
}
module.exports = { limits, usage, storageView, release, saveAttachments, discardAttachments };
