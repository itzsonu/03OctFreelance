const fs = require("node:fs/promises");
const { storageRoot, storageBackend } = require("./fileStorage");
function databaseUriWithPassword(uri, password) {
  let address;
  try { address = new URL(uri); } catch { throw new Error("Use a valid MongoDB address with a username and application database"); }
  if (!["mongodb:", "mongodb+srv:"].includes(address.protocol) || !address.hostname || !address.username || address.password || address.hash) throw new Error("Separate database password requires a username-only MongoDB address");
  if (typeof password !== "string" || !password) throw new Error("MONGO_PASSWORD is required when using a separate database password");
  require("./recovery").namedDatabase(uri);
  let username;
  try { username = decodeURIComponent(address.username); } catch { throw new Error("Database username encoding is invalid"); }
  return address.protocol + "//" + encodeURIComponent(username) + ":" + encodeURIComponent(password) + "@" + address.host + address.pathname + address.search;
}
async function loadSecrets() {
  for (const name of ["MONGO_URI", "MONGO_PASSWORD", "JWT_SECRET", "RESTORE_MONGO_URI"]) {
    if (!process.env[`${name}_FILE`]) continue;
    if (process.env[name]) throw new Error(`Configure only ${name} or ${name}_FILE`);
    process.env[name] = (await fs.readFile(process.env[`${name}_FILE`], "utf8")).trim();
  }
  if (process.env.MONGO_PASSWORD !== undefined) process.env.MONGO_URI = databaseUriWithPassword(process.env.MONGO_URI, process.env.MONGO_PASSWORD);
}
async function checkPrivateStorage() {
  if (storageBackend() === "mongo") return require("./mongoFileStorage").check();
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
  if (storageBackend() === "mongo") require("./mongoFileStorage").limits();
  if (process.env.FC_PROXY_SECRET && (process.env.FC_PROXY_SECRET.length < 32 || process.env.FC_PROXY_SECRET.length > 256)) throw new Error("FC_PROXY_SECRET must contain 32–256 characters");
  if (process.env.NODE_ENV === "production") {
    require("./recovery").namedDatabase(process.env.MONGO_URI);
    if (process.env.RENDER === "true" && (storageBackend() !== "mongo" || !process.env.FC_PROXY_SECRET)) throw new Error("Render requires mongo private uploads and FC_PROXY_SECRET for the same-origin frontend proxy");
  }
  require("./attachmentStorage").limits();
  return { port, host: process.env.HOST || "0.0.0.0" };
}
module.exports = { loadSecrets, config, checkPrivateStorage, databaseUriWithPassword };
