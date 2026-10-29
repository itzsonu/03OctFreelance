// Owner-only local key setup. Never connects to MongoDB or any provider.
const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { createPrompt } = require("./adminConsolePrompt");
let stage = "prepare";
async function buildKeyBundle(passphrase) {
  stage = "generate_key";
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 3072 });
  const { CompactEncrypt, compactDecrypt } = await import("jose");
  const fixture = Buffer.from("FreelanceChain synthetic recovery-key round-trip");
  const ciphertext = await new CompactEncrypt(fixture).setProtectedHeader({ alg: "RSA-OAEP-256", enc: "A256GCM" }).encrypt(publicKey);
  stage = "protect_private_key";
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8", cipher: "aes-256-cbc", passphrase });
  const unlocked = crypto.createPrivateKey({ key: privatePem, passphrase });
  stage = "key_self_check";
  const restored = await compactDecrypt(ciphertext, unlocked, { keyManagementAlgorithms: ["RSA-OAEP-256"], contentEncryptionAlgorithms: ["A256GCM"] });
  if (!Buffer.from(restored.plaintext).equals(fixture)) throw new Error("key_check_failed");
  return { privatePem, publicDer: publicKey.export({ format: "der", type: "spki" }) };
}
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.env.FC_BACKUP_KEY_ROOT) throw new Error("Use the private PowerShell launcher");
  const root = path.resolve(process.env.FC_BACKUP_KEY_ROOT);
  if (path.relative(root, await fs.realpath(root)) !== "") throw new Error("Use a real restricted private key folder");
  const prompt = createPrompt(process.stdin, process.stdout);
  let passphrase = "", repeated = "";
  try {
    console.log("Create the separate PRIVATE recovery key for future automated backups.");
    console.log("Your existing BACKUP encryption passphrase may protect this key. Save it privately; do not use Atlas/admin/Gmail passwords.");
    stage = "passphrase_entry";
    while (true) {
      passphrase = await prompt.ask("Backup recovery-key passphrase, 20+ characters (hidden; CANCEL to stop): ", true);
      if (passphrase.toUpperCase() === "CANCEL") { console.log("Cancelled. No key was created."); return; }
      if (passphrase.length < 20 || passphrase.length > 256 || /[\r\n\0]/.test(passphrase)) {
        passphrase = ""; console.log("Use 20-256 characters without a line break. Please enter it again."); continue;
      }
      repeated = await prompt.ask("Confirm recovery-key passphrase (hidden): ", true);
      if (passphrase !== repeated) { passphrase = repeated = ""; console.log("The two entries did not match. Please enter and confirm again."); continue; }
      repeated = ""; break;
    }
    console.log("Generating and verifying the protected recovery key...");
    const { privatePem, publicDer } = await buildKeyBundle(passphrase);
    stage = "save_private_files";
    const destination = path.join(root, "cloud-key-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"));
    await fs.mkdir(destination, { mode: 0o700 });
    await fs.writeFile(path.join(destination, "PRIVATE-RECOVERY-KEY.pem"), privatePem, { flag: "wx", mode: 0o600 });
    await fs.writeFile(path.join(destination, "public-config.json"), JSON.stringify({
      CLOUD_BACKUP_PUBLIC_KEY: publicDer.toString("base64"), fingerprint: crypto.createHash("sha256").update(publicDer).digest("hex"),
      keySelfTestPassed: true, encryption: "RSA-OAEP-256 + A256GCM (standard JWE)", privateKeyPassphraseStored: false
    }, null, 2), { flag: "wx", mode: 0o600 });
    console.log("CLOUD RECOVERY KEY READY. Tell Codex: KEY READY.");
    console.log("Public configuration: " + path.join(destination, "public-config.json"));
    console.log("PRIVATE recovery key: " + path.join(destination, "PRIVATE-RECOVERY-KEY.pem"));
    console.log("Keep PRIVATE-RECOVERY-KEY.pem and its passphrase separately protected. Do not upload them with backup data or paste them into chat.");
  } finally { passphrase = repeated = ""; prompt.close(); }
}
module.exports = { buildKeyBundle };
if (require.main === module) main().catch(error => {
  const code = /^[A-Z0-9_]{1,45}$/.test(String(error.code || "")) ? error.code : null;
  console.error("Cloud recovery-key setup did not complete. Safe details: " + JSON.stringify({ stage, type: error.name, code }));
  process.exitCode = 1;
});
