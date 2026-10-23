require("dotenv").config({ quiet: true });
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const storage = require("../fileStorage");
const mongoStorage = require("../mongoFileStorage");
const Attachment = require("../models/Attachment");
const PrivateFile = require("../models/PrivateFile");
async function migrate({ apply = false, offlineConfirmed = false, appUrl } = {}) {
  if (apply) await require("../recovery").offline({ offlineConfirmed, appUrl });
  const root = await require("../storageMaintenance").safeRoot();
  const plan = [];
  let reused = 0, newBytes = 0;
  for await (const item of Attachment.find({ $or: [{ storageBackend: "local" }, { storageBackend: { $exists: false } }] }).select("+storageKey +storageBackend").cursor()) {
    const bytes = await storage.readFile(item.storageKey, "local");
    if (!bytes || bytes.length !== item.size || !storage.validateFile({ originalname: item.filename, mimetype: item.mimeType, size: item.size, buffer: bytes })) throw new Error("A local attachment is missing, invalid or has the wrong size. No source files were removed.");
    if (!root) throw new Error("Local uploads directory is unavailable");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const saved = await PrivateFile.findById(item.storageKey).select("sha256 size").lean();
    if (saved && (saved.sha256 !== sha256 || saved.size !== bytes.length)) throw new Error("An existing cloud copy differs. Operator review is required.");
    if (saved) reused++; else newBytes += bytes.length;
    plan.push({ id: item._id, key: item.storageKey, size: item.size, sha256, copied: Boolean(saved) });
  }
  const shared = await mongoStorage.view();
  if (shared.usedBytes + newBytes > shared.maxBytes || shared.usedFiles + plan.length - reused > shared.maxFiles) throw new Error("Migration exceeds the shared upload allowance. Review capacity before applying.");
  if (!apply) return { preview: true, files: plan.length, newBytes, reused, sourceFilesPreserved: true };
  await mongoStorage.init();
  let migrated = 0;
  for (const item of plan) {
    const bytes = await storage.readFile(item.key, "local");
    if (!bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error("Source changed after preview. Stop writers and retry; original files were retained.");
    if (!item.copied) await mongoStorage.store(item.key, bytes);
    const copy = await mongoStorage.read(item.key);
    if (!copy?.equals(bytes)) throw new Error("Cloud copy could not be verified. Original files were retained.");
    const result = await Attachment.updateOne({ _id: item.id, storageKey: item.key, $or: [{ storageBackend: "local" }, { storageBackend: { $exists: false } }] }, { $set: { storageBackend: "mongo" } });
    migrated += result.modifiedCount;
  }
  return { migrated, sourceFilesPreserved: true };
}
async function main() {
  const args = process.argv.slice(2); const options = {};
  while (args.length) {
    const flag = args.shift();
    if (flag === "--apply") options.apply = true;
    else if (flag === "--offline-confirmed") options.offlineConfirmed = true;
    else if (flag === "--app-url" && args[0]) options.appUrl = args.shift();
    else throw new Error("Use [--apply --offline-confirmed --app-url <stopped app URL>]");
  }
  await require("../deployment").loadSecrets();
  require("../recovery").namedDatabase(process.env.MONGO_URI);
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  return migrate(options);
}
if (require.main === module) main().then(result => console.log(JSON.stringify(result))).catch(() => {
  console.error("Upload migration stopped. Check database access, local file integrity, capacity and the offline flags. Original local files were retained."); process.exitCode = 1;
}).finally(() => mongoose.disconnect());
module.exports = { migrate };
