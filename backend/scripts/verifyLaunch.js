// Starts an isolated local MongoDB only for the focused workflow checks.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const net = require("node:net");
async function main() {
  let mongo;
  let mongoBase = process.env.TEST_MONGO_BASE;
  try {
    if (!mongoBase) {
      const listener = net.createServer();
      await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
      const port = listener.address().port;
      await new Promise(resolve => listener.close(resolve));
      const directory = path.resolve(__dirname, "../../work/launch-db-" + crypto.randomBytes(5).toString("hex"));
      fs.mkdirSync(directory, { recursive: true });
      const windowsBinary = "C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe";
      const binary = process.env.FC_TEST_MONGOD || (process.platform === "win32" && fs.existsSync(windowsBinary) ? windowsBinary : "mongod");
      mongo = cp.spawn(binary, ["--dbpath", directory, "--port", String(port), "--bind_ip", "127.0.0.1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let ready = false, startupError;
      mongo.once("error", error => { startupError = error; });
      mongo.stdout.on("data", bytes => { if (String(bytes).includes("Waiting for connections")) ready = true; });
      mongo.stderr.on("data", () => {});
      for (let i = 0; i < 75 && !ready; i++) {
        if (startupError) throw startupError;
        if (mongo.exitCode !== null) throw new Error("Local MongoDB could not start. Set FC_TEST_MONGOD to its executable or TEST_MONGO_BASE to a local test server.");
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!ready) throw new Error("Local verification database startup timed out");
      mongoBase = "mongodb://127.0.0.1:" + port;
    }
    const exit = await new Promise((resolve, reject) => {
      const child = cp.spawn(process.execPath, ["--test", "launchFlows.test.js"], { cwd: path.resolve(__dirname, ".."), env: { ...process.env, TEST_MONGO_BASE: mongoBase }, windowsHide: true, stdio: "inherit" });
      child.once("error", reject); child.once("exit", resolve);
    });
    process.exitCode = exit ?? 1;
  } finally { if (mongo && mongo.exitCode === null) mongo.kill(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
