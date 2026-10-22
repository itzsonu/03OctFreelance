const crypto = require("node:crypto");
const Session = require("./models/Session");
const User = require("./models/User");
const ABSOLUTE_MS = 24 * 60 * 60 * 1000;
const IDLE_MS = 2 * 60 * 60 * 1000;
const secure = () => process.env.NODE_ENV === "production";
const cookieName = () => secure() ? "__Host-fc_session" : "fc_session";
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const csrfFor = token => crypto.createHmac("sha256", process.env.JWT_SECRET).update(`csrf:${token}`).digest("base64url");
const cookieOptions = () => ({ httpOnly: true, secure: secure(), sameSite: "lax", path: "/" });

function sessionToken(req) {
  const entries = (req.headers.cookie || "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${cookieName()}=`));
  if (entries.length !== 1) return null;
  const token = entries[0].slice(cookieName().length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function csrfValid(req, token) {
  const supplied = req.get("X-CSRF-Token");
  const expected = csrfFor(token);
  return typeof supplied === "string" && /^[A-Za-z0-9_-]{43}$/.test(supplied) && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
async function createSession(user) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const session = await Session.create({ tokenHash: hash(token), user: user._id, version: user.tokenVersion || 0, expiresAt: new Date(now.getTime() + ABSOLUTE_MS), lastSeenAt: now });
  return { token, csrfToken: csrfFor(token), session };
}
async function readSession(req, touch = true) {
  const token = sessionToken(req);
  if (!token) return null;
  const now = new Date();
  const session = await Session.findOne({ tokenHash: hash(token), expiresAt: { $gt: now }, lastSeenAt: { $gt: new Date(now.getTime() - IDLE_MS) } });
  if (!session) return null;
  const user = await User.findById(session.user).select("-password");
  if (!user || user.suspended || (user.tokenVersion || 0) !== session.version) return null;
  if (touch && now.getTime() - session.lastSeenAt.getTime() > 60000) await Session.updateOne({ _id: session._id, lastSeenAt: session.lastSeenAt }, { $set: { lastSeenAt: now } });
  return { user, session, token, csrfToken: csrfFor(token) };
}
function setSessionCookie(res, token) { res.cookie(cookieName(), token, { ...cookieOptions(), maxAge: ABSOLUTE_MS }); }
function clearSessionCookie(res) { res.clearCookie(cookieName(), cookieOptions()); }
async function revokeSession(token) { if (token) await Session.deleteOne({ tokenHash: hash(token) }); }
async function revokeUserSessions(userId) {
  // The caller has already incremented tokenVersion, which remains authoritative.
  try { await Session.deleteMany({ user: userId }); }
  catch { console.error("Session cleanup deferred; account version still revokes old sessions."); }
}
async function sessionActive(session) {
  if (!session) return false;
  const now = new Date();
  const [exists, user] = await Promise.all([
    Session.exists({ _id: session._id, expiresAt: { $gt: now }, lastSeenAt: { $gt: new Date(now.getTime() - IDLE_MS) } }),
    User.findById(session.user).select("tokenVersion suspended").lean(),
  ]);
  return !!exists && !!user && !user.suspended && (user.tokenVersion || 0) === session.version;
}
const userView = user => ({ id: user._id, name: user.name, email: user.email, role: user.role });
module.exports = { ABSOLUTE_MS, IDLE_MS, cookieName, csrfValid, createSession, readSession, setSessionCookie, clearSessionCookie, revokeSession, revokeUserSessions, sessionToken, sessionActive, userView };
