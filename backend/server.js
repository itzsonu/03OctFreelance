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
  console.error("Startup failed", JSON.stringify({ stage: startupStage, type: knownTypes.includes(error.name) ? error.name : "Error", code: Number.isInteger(error.code) ? error.code : null }));
  mongoose.disconnect().finally(() => { process.exitCode = 1; });
});
module.exports = { start };
