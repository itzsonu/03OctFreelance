const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const vm = require("node:vm"), crypto = require("node:crypto");
const source = fs.readFileSync(path.join(__dirname, "../deploy/backup-scheduler/Code.gs"), "utf8");
function harness({ badDownload = false, shared = false } = {}) {
  const properties = new Map(), files = new Map(), triggers = [], fp = "a".repeat(64);
  let uploads = 0;
  const digest = text => crypto.createHash("sha256").update(text).digest("hex");
  const ciphertext = "eyJhbGciOiJSU0EtT0FFUC0yNTYifQ.synthetic.synthetic.synthetic.synthetic";
  const owner = "owner@example.test", audience = "synthetic.apps.googleusercontent.com";
  const token = "synthetic." + Buffer.from(JSON.stringify({ email_verified: true, email: owner, aud: audience })).toString("base64url") + ".synthetic";
  const response = body => ({ getResponseCode: () => 200, getContentText: () => typeof body === "string" ? body : JSON.stringify(body) });
  const blob = text => ({ getBytes: () => [...Buffer.from(text)], getDataAsString: () => Buffer.from(text).toString() });
  const context = {
    console: { log() {} }, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value),
      setProperties: values => Object.entries(values).forEach(([key, value]) => properties.set(key, value))
    }) },
    ScriptApp: { getIdentityToken: () => token, getOAuthToken: () => "synthetic-oauth-not-live", getProjectTriggers: () => triggers,
      WeekDay: { SUNDAY: "SUNDAY" }, newTrigger: handler => {
        const builder = { timeBased: () => builder, inTimezone: () => builder, onWeekDay: () => builder,
          atHour: () => builder, everyWeeks: () => builder,
          create: () => { triggers.push({ getHandlerFunction: () => handler }); } }; return builder;
      } },
    Utilities: { base64DecodeWebSafe: value => Buffer.from(value, "base64url"), newBlob: blob, formatDate: () => "2026-10-29",
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (algorithm, text) => [...crypto.createHash("sha256").update(text).digest()], sleep() {} },
    Drive: { Files: {
      create: (metadata, bytes) => {
        const id = bytes ? "ciphertext-file" : "folder";
        if (bytes) uploads++;
        files.set(id, { id, name: metadata.name, mimeType: metadata.mimeType, shared, permissions: [{ role: "owner", emailAddress: owner }],
          parents: metadata.parents || [], size: bytes ? bytes.getBytes().length : undefined, appProperties: metadata.appProperties, blob: bytes });
        return { id };
      },
      get: id => files.get(id),
      list: () => ({ files: [...files.values()].filter(file => file.appProperties) })
    } },
    UrlFetchApp: { fetch: (url, options) => {
      assert.equal(options.followRedirects, false); assert.equal(options.validateHttpsCertificates, true);
      if (url.endsWith("/api/health/ready")) return response({ status: "ready" });
      if (url.endsWith("/api/backup-cloud/v1/status")) return response({ keyFingerprint: fp });
      if (url.endsWith("/api/backup-cloud/v1/export")) return response({ format: "JWE-zip-v1", keyFingerprint: fp, ciphertext,
        bytes: Buffer.byteLength(ciphertext), sha256: digest(ciphertext), fileName: "FreelanceChain-auto-2026-10-29T00-00-00-000Z.zip.jwe", summary: { documents: 3 } });
      if (url.startsWith("https://www.googleapis.com/drive/v3/files/")) return response(badDownload ? "damaged-ciphertext" : ciphertext);
      throw new Error("Unexpected network destination");
    } }
  };
  vm.createContext(context); vm.runInContext(source, context);
  return { context, properties, triggers, uploads: () => uploads };
}
test("scheduler uses app-file scope and installs one weekly trigger only after verified upload/download", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../deploy/backup-scheduler/appsscript.json")));
  assert.ok(manifest.oauthScopes.includes("https://www.googleapis.com/auth/drive.file"));
  assert.equal(manifest.oauthScopes.includes("https://www.googleapis.com/auth/drive"), false);
  const app = harness(); app.context.setupBackup(); app.properties.set("EXPECTED_KEY_FINGERPRINT", "a".repeat(64));
  app.context.installWeeklyBackup(); assert.equal(app.triggers.length, 1); assert.equal(app.uploads(), 1);
  app.context.installWeeklyBackup(); assert.equal(app.triggers.length, 1); assert.equal(app.uploads(), 1);
});
test("scheduler rejects shared destinations and corrupted downloaded ciphertext without enabling a trigger", () => {
  const shared = harness({ shared: true }); assert.throws(() => shared.context.setupBackup()); assert.equal(shared.uploads(), 0);
  const damaged = harness({ badDownload: true }); damaged.context.setupBackup(); damaged.properties.set("EXPECTED_KEY_FINGERPRINT", "a".repeat(64));
  assert.throws(() => damaged.context.installWeeklyBackup()); assert.equal(damaged.triggers.length, 0);
  assert.equal(damaged.properties.has("LAST_VERIFIED_BACKUP"), false);
});
