const express = require("express"), crypto = require("node:crypto");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User"), Challenge = require("../models/GoogleLoginChallenge");
const { createSession, setSessionCookie, revokeSession, sessionToken, userView } = require("../sessions");
const client = new OAuth2Client();
const router = express.Router();
const id = () => (process.env.GOOGLE_CLIENT_ID || "").trim();
const configured = () => /^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(id());
const cookieName = () => process.env.NODE_ENV === "production" ? "__Host-fc_google_nonce" : "fc_google_nonce";
const options = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const validChoice = body => ["client", "freelancer"].includes(body?.role) && ["login", "register"].includes(body?.mode);
function nonceCookie(req) {
  const values = (req.headers.cookie || "").split(";").map(x => x.trim()).filter(x => x.startsWith(cookieName() + "="));
  const value = values.length === 1 ? values[0].slice(cookieName().length + 1) : "";
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
router.get("/status", (_req, res) => res.json({ available: configured(), ...(configured() ? { clientId: id() } : {}) }));
router.post("/challenge", async (req, res) => {
  if (!configured()) return res.status(503).json({ message: "Google sign-in is unavailable. Use email and password." });
  if (!validChoice(req.body)) return res.status(400).json({ message: "Choose Client or Freelancer and a sign-in mode." });
  try {
    const nonce = crypto.randomBytes(32).toString("base64url");
    await Challenge.create({ _id: hash(nonce), role: req.body.role, mode: req.body.mode, expiresAt: new Date(Date.now() + 5 * 60000) });
    res.cookie(cookieName(), nonce, { ...options(), maxAge: 5 * 60000 });
    res.json({ nonce, clientId: id() });
  } catch { res.status(503).json({ message: "Google sign-in could not start. Please try again." }); }
});
router.post("/", async (req, res) => {
  if (!configured()) return res.status(503).json({ message: "Google sign-in is unavailable. Use email and password." });
  const nonce = nonceCookie(req);
  if (!nonce || !validChoice(req.body) || typeof req.body.credential !== "string" || req.body.credential.length > 10000) return res.status(400).json({ message: "Google sign-in expired. Try Google sign-in again." });
  try {
    const challenge = await Challenge.findOne({ _id: hash(nonce), expiresAt: { $gt: new Date() }, role: req.body.role, mode: req.body.mode }).lean();
    if (!challenge) return res.status(400).json({ message: "Google sign-in expired. Try Google sign-in again." });
    let payload;
    try { payload = (await client.verifyIdToken({ idToken: req.body.credential, audience: id() })).getPayload(); }
    catch { return res.status(400).json({ message: "Google sign-in could not be verified. Try again." }); }
    if (!payload || payload.nonce !== nonce || payload.aud !== id() || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss) || !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now() || payload.email_verified !== true || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 || typeof payload.email !== "string" || payload.email.length > 254 || !/^\S+@\S+\.\S+$/.test(payload.email)) return res.status(400).json({ message: "Google sign-in could not be verified. Try again." });
    const email = payload.email.trim().toLowerCase();
    // Google is authoritative only for Gmail or a verified Workspace domain.
    if (!email.endsWith("@gmail.com") && !(typeof payload.hd === "string" && payload.hd)) return res.status(403).json({ message: "Use email/password signup and inbox verification for this Google account." });
    const consumed = await Challenge.findOneAndDelete({ _id: challenge._id, role: challenge.role, mode: challenge.mode, expiresAt: { $gt: new Date() } });
    if (!consumed) return res.status(400).json({ message: "Google sign-in already used. Try again." });
    res.clearCookie(cookieName(), options());
    let user = await User.findOne({ googleSubject: payload.sub }).select("+googleSubject");
    if (!user) {
      user = await User.findOne({ email }).select("+googleSubject");
      if (user) {
        if (user.role !== challenge.role || user.role === "admin" || user.suspended) return res.status(403).json({ message: "Use the matching account type or contact support." });
        if (user.googleSubject || !user.emailVerifiedAt) return res.status(409).json({ message: "Sign in with your password and verify your email before using Google for this account." });
        user = await User.findOneAndUpdate({ _id: user._id, email, emailVerifiedAt: { $ne: null }, googleSubject: { $exists: false }, suspended: { $ne: true } }, { $set: { googleSubject: payload.sub } }, { returnDocument: "after" });
        if (!user) return res.status(409).json({ message: "Your account changed. Please try again." });
      } else {
        if (challenge.mode !== "register") return res.status(404).json({ message: "No account found. Choose Sign up to create your Google account." });
        const name = typeof payload.name === "string" && payload.name.trim().length >= 2 ? payload.name.trim().slice(0, 100) : "Google user";
        user = await User.create({ name, email, role: challenge.role, authProvider: "google", googleSubject: payload.sub, emailVerifiedAt: new Date() });
      }
    }
    if (user.role !== challenge.role || user.role === "admin" || user.suspended) return res.status(403).json({ message: "Use the matching account type or contact support." });
    const created = await createSession(user);
    await revokeSession(sessionToken(req));
    setSessionCookie(res, created.token);
    res.json({ message: "Google sign-in successful", csrfToken: created.csrfToken, expiresAt: created.session.expiresAt, user: userView(user) });
  } catch (error) { res.status(error.code === 11000 ? 409 : 503).json({ message: error.code === 11000 ? "This account is already linked. Please sign in again." : "Google sign-in is temporarily unavailable. Try again." }); }
});
module.exports = router;
