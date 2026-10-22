const fs = require("node:fs/promises");
const { storageRoot } = require("./fileStorage");
async function loadSecrets() {
  for (const name of ["MONGO_URI", "JWT_SECRET", "RESTORE_MONGO_URI"]) {
    if (!process.env[`${name}_FILE`]) continue;
    if (process.env[name]) throw new Error(`Configure only ${name} or ${name}_FILE`);
    process.env[name] = (await fs.readFile(process.env[`${name}_FILE`], "utf8")).trim();
  }
}
async function checkPrivateStorage() {
  await fs.mkdir(storageRoot(), { recursive: true, mode: 0o700 });
  await require("./storageMaintenance").safeRoot();
  await fs.access(storageRoot(), require("node:fs").constants.W_OK | require("node:fs").constants.R_OK);
}
function config() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI or MONGO_URI_FILE is required");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
  const port = Number(process.env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be from 1 to 65535");
  if (process.env.NODE_ENV === "production") {
    let origin; try { origin = new URL(process.env.APP_ORIGIN); } catch { throw new Error("Production APP_ORIGIN must be an exact HTTPS origin"); }
    if (origin.protocol !== "https:" || origin.origin !== process.env.APP_ORIGIN) throw new Error("Production APP_ORIGIN must be an exact HTTPS origin");
    if (process.env.RESET_DELIVERY === "console") throw new Error("Console password-reset delivery is for local demos only");
  }
  require("./attachmentStorage").limits();
  return { port, host: process.env.HOST || "0.0.0.0" };
}
module.exports = { loadSecrets, config, checkPrivateStorage };
