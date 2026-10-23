const crypto = require("node:crypto");
const net = require("node:net");
const Bucket = require("./models/RateBucket");
const MINUTE = 60000;

function ipIdentity(address = "unknown") {
  if (address.startsWith("::ffff:") && net.isIP(address.slice(7)) === 4) return address.slice(7);
  if (net.isIP(address) !== 6) return address;
  const halves = address.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return groups.slice(0, 4).map(x => parseInt(x || "0", 16).toString(16)).join(":") + "::/64";
}
async function consume(scope, identity, max, windowMs, now = Date.now()) {
  const start = Math.floor(now / windowMs) * windowMs;
  const id = crypto.createHash("sha256").update(`${scope}:${identity}:${start}`).digest("hex");
  const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(start + windowMs + MINUTE) } };
  let bucket;
  try { bucket = await Bucket.findOneAndUpdate({ _id: id }, update, { upsert: true, returnDocument: "after" }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    bucket = await Bucket.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { returnDocument: "after" });
  }
  return { allowed: bucket.count <= max, retryAfter: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
}
function actionFor(req) {
  const path = req.originalUrl.split("?")[0].toLowerCase().replace(/\/+$/, "");
  if (path === "/api/auth/login") return ["login", 20, 15 * MINUTE, 20];
  if (path === "/api/auth/register") return ["registration", 10, 60 * MINUTE, 10];
  if (path === "/api/support") return ["support-submissions", 5, 60 * MINUTE, 5];
  if (path === "/api/support/status") return ["support-tracking", 30, 15 * MINUTE, 30];
  if (path === "/api/account/support") return ["support-submissions", 5, 60 * MINUTE, 20];
  if (path === "/api/account/deletion-request") return ["deletion-requests", 3, 60 * MINUTE, 20];
  if (path.startsWith("/api/admin/storage/")) return ["storage-maintenance", 5, 15 * MINUTE, 20];
  if (path === "/api/auth/forgot-password") return ["password-recovery", 5, 15 * MINUTE, 5];
  if (path === "/api/auth/reset-password" || path === "/api/account/email/confirm") return ["security-confirmation", 10, 15 * MINUTE, 10];
  if (/^\/api\/projects\/create$|^\/api\/project-drafts\/[^/]+\/publish$/.test(path)) return ["project-publication", 20, 60 * MINUTE, 80];
  if (path === "/api/applications" || path === "/api/applications/") return ["proposals", 10, 10 * MINUTE, 60];
  if (path.startsWith("/api/messages/")) return ["messages", 30, MINUTE, 120];
  if (path.startsWith("/api/applications/")) return ["hiring-actions", 60, 10 * MINUTE, 240];
  if (path.startsWith("/api/invitations")) return ["invitations", 15, 10 * MINUTE, 60];
  if (path.startsWith("/api/project-drafts")) return ["draft-saving", 30, MINUTE, 120];
  if (path.startsWith("/api/task-boards/")) return ["task-changes", 60, MINUTE, 180];
  if (path.startsWith("/api/account")) return ["account-changes", 20, 15 * MINUTE, 100];
  return null;
}
const unsafe = req => !["GET", "HEAD", "OPTIONS"].includes(req.method);
const multipart = req => /^multipart\/form-data\s*(?:;|$)/i.test(req.get("content-type") || "");
async function check(res, scope, key, max, duration) {
  const result = await consume(scope, key, max, duration);
  if (result.allowed) return true;
  res.set("Retry-After", String(result.retryAfter));
  res.status(429).json({ code: "RATE_LIMITED", retryAfter: result.retryAfter, message: `Too many ${scope.replace(/^(ip|user)-/, "").replaceAll("-", " ")}. Try again in ${result.retryAfter} seconds.` });
  return false;
}
async function limitIp(req, res, next) {
  if (!unsafe(req)) return next();
  try {
    const ip = ipIdentity(req.ip);
    if (!await check(res, "ip-requests", ip, 600, MINUTE)) return;
    const action = actionFor(req);
    if (action && !await check(res, `ip-${action[0]}`, ip, action[3], action[2])) return;
    if (multipart(req) && !await check(res, "ip-uploads", ip, 40, 10 * MINUTE)) return;
    // Per-address identity buckets stop concentrating all allowed attempts on one inbox.
    if (["/api/auth/login", "/api/auth/forgot-password"].includes(req.originalUrl.split("?")[0].toLowerCase().replace(/\/+$/, ""))) {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : "";
      if (email && !await check(res, "ip-account-attempts", `${ip}:${email}`, 10, 15 * MINUTE)) return;
    }
    next();
  } catch { res.status(503).json({ message: "Request protection is temporarily unavailable. Please try later." }); }
}
async function limitUser(req, res) {
  if (!unsafe(req)) return true;
  const id = String(req.user._id);
  if (!await check(res, "user-requests", id, 240, MINUTE)) return false;
  const action = actionFor(req);
  if (action && !await check(res, `user-${action[0]}`, id, action[1], action[2])) return false;
  if (multipart(req) && !await check(res, "user-uploads", id, 10, 10 * MINUTE)) return false;
  return true;
}
module.exports = { consume, limitIp, limitUser, ipIdentity, actionFor };
