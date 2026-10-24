require("dotenv").config();
const mongoose = require("mongoose");
const deployment = require("./deployment");
let startupStage = "configuration";
async function start() {
  await deployment.loadSecrets();
  const settings = deployment.config();
  startupStage = "database";
  await require("./db")();
  startupStage = "private_storage";
  if (require("./fileStorage").storageBackend() === "mongo") await require("./mongoFileStorage").init();
  await deployment.checkPrivateStorage();
  startupStage = "collections";
  await Promise.all([require("./models/Session").init(), require("./models/RateBucket").init(), require("./models/StorageUsage").init(), require("./models/SupportRequest").init()]);
  await Promise.all([require("./models/ProjectTask").init(), require("./models/Notification").init()]);
  startupStage = "http";
  const app = require("./app");
  const stopWorker = require("./eventEmails").startEventEmailWorker();
  const stopTaskWorker = require("./taskReminders").startTaskReminderWorker();
  let stopping = false;
  const server = app.listen(settings.port, settings.host, () => console.log("Server running on port " + settings.port));
  async function shutdown() {
    if (stopping) return; stopping = true; app.locals.draining = true;
    stopWorker(); stopTaskWorker(); require("./liveUpdates").disconnectAll();
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 25000); deadline.unref();
    await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); clearTimeout(deadline);
  }
  server.on("error", error => { console.error("HTTP listener failed:", error.code || "error"); process.exitCode = 1; shutdown().catch(() => process.exit(1)); });
  process.once("SIGTERM", () => shutdown().catch(() => process.exit(1)));
  process.once("SIGINT", () => shutdown().catch(() => process.exit(1)));
  return { server, shutdown };
}
if (require.main === module) start().catch(error => {
  const knownTypes = ["MongoServerError", "MongoParseError", "MongoServerSelectionError", "MongooseServerSelectionError", "MongoNetworkError", "ValidationError", "Error"];
  const configReasons = {
    "MONGO_URI or MONGO_URI_FILE is required": "database_uri_missing",
    "JWT_SECRET must contain at least 32 characters": "session_secret_too_short",
    "FC_PROXY_SECRET must contain 32–256 characters": "proxy_secret_invalid_length",
    "Production APP_ORIGIN must be an exact HTTPS origin": "frontend_origin_invalid",
    "Use a URI with an explicit application database name": "database_name_missing_or_invalid",
    "Render requires mongo private uploads and FC_PROXY_SECRET for the same-origin frontend proxy": "render_storage_or_proxy_missing",
    "UPLOAD_SHARED_QUOTA_MB must be from 1 to 10000": "shared_upload_quota_invalid",
    "UPLOAD_USER_QUOTA_MB must be an integer from 1 to 10000": "user_upload_quota_invalid",
    "PRIVATE_UPLOAD_BACKEND must be local or mongo": "upload_backend_invalid",
    "PORT must be from 1 to 65535": "port_invalid",
    "Console password-reset delivery is for local demos only": "reset_delivery_invalid"
  };
  console.error("Startup failed", JSON.stringify({ stage: startupStage, reason: startupStage === "configuration" ? configReasons[error.message] || "configuration_invalid" : undefined, type: knownTypes.includes(error.name) ? error.name : "Error", code: Number.isInteger(error.code) ? error.code : null }));
  mongoose.disconnect().finally(() => { process.exitCode = 1; });
});
module.exports = { start };
