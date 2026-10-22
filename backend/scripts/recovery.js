require("dotenv").config({ quiet: true });
const path = require("node:path");
const recovery = require("../recovery");
async function main() {
  const args = process.argv.slice(2); const command = args.shift();
  const allowed = new Set(["--directory", "--uploads", "--app-url", "--offline-confirmed", "--apply"]); const flags = {};
  while (args.length) { const key = args.shift(); if (!allowed.has(key) || flags[key] !== undefined) throw new Error("Invalid argument"); flags[key] = ["--apply", "--offline-confirmed"].includes(key) ? true : args.shift(); }
  if (!["backup", "verify", "restore"].includes(command) || !flags["--directory"]) throw new Error("Usage: node scripts/recovery.js backup|verify|restore --directory <snapshot> [--uploads <private directory>] [--app-url <stopped app>] [--offline-confirmed] [--apply]");
  await require("../deployment").loadSecrets();
  const common = { source: path.resolve(flags["--directory"]), uploads: path.resolve(flags["--uploads"] || require("../fileStorage").storageRoot()), offlineConfirmed: flags["--offline-confirmed"] === true, appUrl: flags["--app-url"] || process.env.APP_ORIGIN };
  if (command === "verify") { const result = await recovery.verify(common.source); return { verified: true, collections: result.manifest.collections.length, files: result.manifest.uploads.length }; }
  if (command === "backup") return recovery.backup({ ...common, uri: process.env.MONGO_URI, destination: common.source });
  return recovery.restore({ ...common, uri: process.env.RESTORE_MONGO_URI, apply: flags["--apply"] === true });
}
main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
  // Driver diagnostics can include credential-bearing URIs. Keep them out of logs.
  console.error(error.name === "Error" ? error.message : "Recovery failed. Check access and the private snapshot. A failed restore must use a new empty target before retrying."); process.exitCode = 1;
});
