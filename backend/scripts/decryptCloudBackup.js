const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const zlib = require("node:zlib"), { unzipSync } = require("fflate");
const { createPrompt } = require("./adminConsolePrompt");
async function unpack(ciphertext, privateKey, destination) {
  if (typeof ciphertext !== "string" || Buffer.byteLength(ciphertext) > 24 * 1024 * 1024) throw new Error("Archive size limit");
  const { compactDecrypt } = await import("jose");
  const { plaintext, protectedHeader } = await compactDecrypt(ciphertext, privateKey,
    { keyManagementAlgorithms: ["RSA-OAEP-256"], contentEncryptionAlgorithms: ["A256GCM"] });
  if (protectedHeader.typ !== "fc-backup+zip" || protectedHeader.v !== 1 || plaintext.length > 16 * 1024 * 1024) throw new Error("Unsupported archive");
  let total = 0, count = 0; const names = new Set();
  const files = unzipSync(plaintext, { filter: file => {
    const allowed = /^(?:snapshot\/(?:manifest\.json|collection-\d{4,}\.jsonl\.gz)|backup-report\.json|READ_ME\.txt)$/.test(file.name);
    if (!allowed || names.has(file.name) || !Number.isSafeInteger(file.originalSize) || file.originalSize < 0 ||
      file.originalSize > 16 * 1024 * 1024 || (total += file.originalSize) > 20 * 1024 * 1024 || ++count > 203) throw new Error("Unexpected ZIP content");
    names.add(file.name); return true;
  } });
  if (!files["snapshot/manifest.json"] || !files["backup-report.json"]) throw new Error("Incomplete archive");
  await fs.mkdir(destination); await fs.mkdir(path.join(destination, "snapshot")); await fs.mkdir(path.join(destination, "snapshot", "uploads"));
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(destination, name), bytes, { flag: "wx", mode: 0o600 });
  const { manifest } = await require("../recovery").verify(path.join(destination, "snapshot"));
  let documents = 0, expanded = 0;
  for (const file of manifest.collections) {
    const bytes = zlib.gunzipSync(files["snapshot/" + file.name], { maxOutputLength: 32 * 1024 * 1024 });
    expanded += bytes.length;
    if (expanded > 32 * 1024 * 1024) throw new Error("Expanded snapshot size limit");
    const count = bytes.toString("utf8").split("\n").filter(Boolean).length;
    if (count !== file.count) throw new Error("Document count mismatch");
    documents += count;
  }
  return { sourceDatabase: manifest.sourceDatabase, snapshotIntegrityVerified: true,
    collections: manifest.collections.length, documents, productionCutoverPerformed: false, databaseRestorePerformed: false };
}
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.env.FC_PRIVATE_BACKUP_ROOT) throw new Error("Use the private owner launcher");
  const archive = path.resolve(process.argv[2] || ""), keyPath = path.resolve(process.argv[3] || "");
  if (!archive.endsWith(".jwe") || !keyPath.endsWith(".pem")) throw new Error("Supply the encrypted .jwe and encrypted recovery-key .pem paths");
  const stat = await fs.lstat(archive), keyStat = await fs.lstat(keyPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 24 * 1024 * 1024 ||
    !keyStat.isFile() || keyStat.isSymbolicLink() || keyStat.size > 16384) throw new Error("Unsafe input files");
  const root = path.resolve(process.env.FC_PRIVATE_BACKUP_ROOT);
  if (path.relative(root, await fs.realpath(root)) !== "") throw new Error("Use a real restricted private directory");
  const prompt = createPrompt(process.stdin, process.stdout); let passphrase = "";
  try {
    passphrase = await prompt.ask("BACKUP recovery-key passphrase (hidden): ", true);
    const privateKey = crypto.createPrivateKey({ key: await fs.readFile(keyPath), passphrase });
    passphrase = "";
    const destination = path.join(root, "cloud-decrypted-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"));
    const report = await unpack(await fs.readFile(archive, "utf8"), privateKey, destination);
    await fs.writeFile(path.join(destination, "decryption-report.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 });
    console.log("CLOUD BACKUP DECRYPTED AND VERIFIED. No database was restored or modified.");
    console.log("Private snapshot: " + path.join(destination, "snapshot"));
    console.log("Report: " + path.join(destination, "decryption-report.json"));
  } finally { passphrase = ""; prompt.close(); }
}
module.exports = { unpack };
if (require.main === module) main().catch(error => { console.error("Cloud backup verification failed. Safe type: " + error.name); process.exitCode = 1; });
