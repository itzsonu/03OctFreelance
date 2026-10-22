const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const Session = require("./models/Session");
const Bucket = require("./models/RateBucket");
const { consume, ipIdentity } = require("./abuseProtection");
const { testSession, authHeaders, responseAuth } = require("./testSession");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.APP_ORIGIN = "http://localhost:5000";
const app = require("./app");

test("cookie sessions, CSRF, revocation and shared abuse protection", async t => {
  const database = `freelancechain_security_test_${crypto.randomBytes(8).toString("hex")}`;
  let server;
  try {
    await mongoose.connect(`${process.env.TEST_MONGO_BASE || "mongodb://127.0.0.1:27017"}/${database}`, { serverSelectionTimeoutMS: 5000 });
    await Promise.all([Session.init(), Bucket.init()]);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const password = "security-test-password";
    const hashed = await bcrypt.hash(password, 4);
    const client = await User.create({ name: "Client", email: "client@example.test", password: hashed, role: "client" });
    const freelancer = await User.create({ name: "Freelancer", email: "freelancer@example.test", password: hashed, role: "freelancer" });
    async function call(method, path, auth, body, headers = {}) {
      const multipart = body instanceof FormData;
      const response = await fetch(base + path, { method, headers: { ...authHeaders(auth), ...(!multipart && body ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}) });
      const data = await response.json();
      return { response, data, auth: responseAuth(response, data) };
    }
    async function login(old) {
      const result = await call("POST", "/auth/login", old, { email: client.email, password, role: "client" });
      assert.equal(result.response.status, 200, JSON.stringify(result.data));
      assert.equal(result.data.token, undefined);
      return result;
    }
    await t.test("login creates an HttpOnly cookie; restored identity never exposes the secret", async () => {
      const result = await login();
      const cookie = result.response.headers.get("set-cookie");
      assert.match(cookie, /^fc_session=/); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\//);
      const raw = result.auth.cookie.split("=")[1];
      assert.ok(!JSON.stringify(result.data).includes(raw));
      const stored = await Session.findOne({ user: client._id });
      assert.notEqual(stored.tokenHash, raw);
      const restored = await call("GET", "/auth/session", result.auth);
      assert.equal(restored.data.user.id, String(client._id));
      assert.equal(restored.data.csrfToken, result.auth.csrfToken);
      assert.equal(restored.response.headers.get("cache-control"), "no-store");
      assert.equal((await call("GET", "/account", null, null, { Authorization: `Bearer ${raw}` })).response.status, 401);
      const previousEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        const secureLogin = await login();
        const secureCookie = secureLogin.response.headers.get("set-cookie");
        assert.match(secureCookie, /^__Host-fc_session=/); assert.match(secureCookie, /; Secure/); assert.ok(!secureCookie.includes("Domain="));
        assert.ok(secureLogin.response.headers.get("strict-transport-security"));
      } finally { if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv; }
    });
    await t.test("cross-site, simple-request and invalid CSRF mutations are rejected", async () => {
      const auth = await testSession(client);
      assert.equal((await call("PUT", "/profile/me", auth, { companyName: "Spoof" }, { "X-CSRF-Token": "wrong" })).response.status, 403);
      const missing = await fetch(base + "/profile/me", { method: "PUT", headers: { Cookie: auth.cookie, "Content-Type": "application/json", "X-FreelanceChain-Request": "1" }, body: "{}" });
      assert.equal(missing.status, 403);
      assert.equal((await call("PUT", "/profile/me", auth, { companyName: "Spoof" }, { Origin: "https://evil.example" })).response.status, 403);
      const simple = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      assert.equal(simple.status, 403);
      assert.notEqual((await User.findById(client._id)).company?.name, "Spoof");
      const preflight = await fetch(base + "/profile/me", { method: "OPTIONS", headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "X-CSRF-Token,X-FreelanceChain-Request" } });
      assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
      assert.equal((await call("PUT", "/profile/me", auth, { companyName: "Valid update" })).response.status, 200);
    });
    await t.test("login rotates a session; logout revokes that device and closes its live stream", async () => {
      const first = await login();
      const rotated = await login(first.auth);
      assert.notEqual(rotated.auth.cookie, first.auth.cookie);
      assert.equal((await call("GET", "/account", first.auth)).response.status, 401);
      const other = await login();
      const abort = new AbortController();
      const stream = await fetch(base + "/updates", { headers: authHeaders(rotated.auth), signal: abort.signal });
      const reader = stream.body.getReader(); await reader.read();
      assert.equal((await call("POST", "/auth/logout", rotated.auth)).response.status, 200);
      assert.equal((await call("GET", "/account", rotated.auth)).response.status, 401);
      assert.equal((await call("GET", "/account", other.auth)).response.status, 200);
      const ended = await Promise.race([reader.read(), new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("Stream did not close")), 2000); timer.unref(); })]);
      assert.equal(ended.done, true); abort.abort();
      const newest = await login();
      assert.equal((await call("POST", "/account/logout-all", newest.auth, { currentPassword: password })).response.status, 200);
      assert.equal((await call("GET", "/account", other.auth)).response.status, 401);
      assert.equal((await call("GET", "/account", newest.auth)).response.status, 401);
    });
    await t.test("absolute and idle expiry are enforced before TTL cleanup", async () => {
      const fresh = await User.findById(client._id);
      for (const update of [{ expiresAt: new Date(0) }, { lastSeenAt: new Date(Date.now() - 3 * 60 * 60 * 1000) }]) {
        const auth = await testSession(fresh);
        const tokenHash = crypto.createHash("sha256").update(auth.cookie.split("=")[1]).digest("hex");
        await Session.updateOne({ tokenHash }, { $set: update });
        assert.equal((await call("GET", "/account", auth)).response.status, 401);
      }
    });
    await t.test("message, proposal, project and upload bursts are limited across sign-ins", async () => {
      const actor = await User.findById(client._id);
      const auth = await testSession(actor);
      for (let i = 0; i < 30; i++) assert.equal((await call("POST", "/messages/application/invalid", auth, { body: "Spam" })).response.status, 400);
      const second = await testSession(actor);
      const blocked = await call("POST", "/MESSAGES/application/invalid/", second, { body: "Spam" });
      assert.equal(blocked.response.status, 429); assert.ok(Number(blocked.response.headers.get("retry-after")) > 0);
      const free = await testSession(freelancer);
      for (let i = 0; i < 10; i++) assert.equal((await call("POST", "/applications", free, {})).response.status, 400);
      assert.equal((await call("POST", "/APPLICATIONS/", free, {})).response.status, 429);
      for (let i = 0; i < 20; i++) assert.equal((await call("POST", "/projects/create", auth, {})).response.status, 400);
      assert.equal((await call("POST", "/PROJECTS/CREATE/", auth, {})).response.status, 429);
      for (let i = 0; i < 10; i++) {
        const result = await call("POST", "/workrooms/projects/invalid/disputes", auth, new FormData());
        assert.ok([400, 404].includes(result.response.status));
      }
      assert.equal((await call("POST", "/workrooms/projects/invalid/disputes", auth, new FormData(), { "Content-Type": "multipart/form-data ; boundary=unused" })).response.status, 429);
    });
    await t.test("shared counters are atomic and untrusted forwarded IPs cannot evade limits", async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => consume("concurrency-test", "one-user", 3, 60000)));
      assert.equal(results.filter(result => result.allowed).length, 3);
      assert.equal((await consume("concurrency-test", "one-user", 3, 60000)).allowed, false);
      assert.equal(ipIdentity("2001:db8:1:2::1"), ipIdentity("2001:db8:1:2::ff"));
      assert.equal(ipIdentity("::ffff:127.0.0.1"), "127.0.0.1");
      for (let i = 0; i < 5; i++) assert.equal((await call("POST", "/auth/forgot-password", null, { email: "invalid" }, { "X-Forwarded-For": `198.51.100.${i + 1}` })).response.status, 400);
      const blocked = await call("POST", "/auth/forgot-password", null, { email: "invalid" }, { "X-Forwarded-For": "203.0.113.1" });
      assert.equal(blocked.response.status, 429);
      assert.ok((await Bucket.collection.indexes()).some(index => index.expireAfterSeconds === 0));
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
