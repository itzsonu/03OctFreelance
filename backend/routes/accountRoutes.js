const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");
const { resetDeliveryMode, resetDeliveryReady, sendEmailChangeLink } = require("../resetMail");
const { emailChangeFields, resetFields, passwordError } = require("../accountSecurity");
const { disconnectUser } = require("../liveUpdates");
const { EMAIL_CATEGORIES, emailPreferences } = require("../emailPreferences");
const { clearSessionCookie, revokeUserSessions } = require("../sessions");
const router = express.Router();
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const handle = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) { res.status(error.status || (error.code === 11000 ? 409 : 500)).json({ message: error.status ? error.message : error.code === 11000 ? "This email address is unavailable. Request a different address." : "Unable to update account" }); }
};
async function authenticatedPassword(req) {
  const value = req.body?.currentPassword;
  if (typeof value !== "string" || !value || value.length > 128) fail(400, "Enter your current password");
  const user = await User.findById(req.user._id);
  if (user && !user.password) fail(400, "Use Forgot password to create a password before changing these settings.");
  if (!user || !await bcrypt.compare(value, user.password)) fail(400, "Current password is incorrect");
  if ((user.tokenVersion || 0) !== (req.user.tokenVersion || 0)) fail(409, "Your session changed. Log in again.");
  return user;
}
function versionFilter(user) {
  return { _id: user._id, password: user.password, $or: [{ tokenVersion: user.tokenVersion || 0 }, ...(user.tokenVersion ? [] : [{ tokenVersion: { $exists: false } }])] };
}

router.get("/", protect, handle(async (req, res) => {
  const user = await User.findById(req.user._id).select("name email emailVerifiedAt +pendingEmail +emailChangeExpiresAt");
  res.json({ name: user.name, email: user.email, emailVerified: !!user.emailVerifiedAt, pendingEmail: user.emailChangeExpiresAt > new Date() ? user.pendingEmail || null : null, emailChangeExpiresAt: user.emailChangeExpiresAt > new Date() ? user.emailChangeExpiresAt : null, deliveryMode: resetDeliveryMode() });
}));

router.get("/notification-preferences", protect, handle(async (req, res) => {
  res.json({ preferences: emailPreferences(req.user), deliveryMode: resetDeliveryMode(), enabled: process.env.EVENT_EMAILS_ENABLED === "true" });
}));
router.put("/notification-preferences", protect, handle(async (req, res) => {
  const values = req.body?.preferences;
  if (!values || typeof values !== "object" || Array.isArray(values) || Object.keys(values).some(key => !EMAIL_CATEGORIES.includes(key)) || EMAIL_CATEGORIES.some(key => typeof values[key] !== "boolean")) fail(400, "Choose true or false for all four email preferences");
  const preferences = Object.fromEntries(EMAIL_CATEGORIES.map(key => [key, values[key]]));
  await User.updateOne({ _id: req.user._id }, { $set: { emailPreferences: preferences } });
  res.json({ preferences, message: "Email preferences saved. In-app notifications stay enabled." });
}));

router.post("/password", protect, handle(async (req, res) => {
  const error = passwordError(req.body?.password);
  if (error) fail(400, error);
  const user = await authenticatedPassword(req);
  if (await bcrypt.compare(req.body.password, user.password)) fail(400, "Choose a different password");
  const password = await bcrypt.hash(req.body.password, 10);
  const changed = await User.findOneAndUpdate(versionFilter(user), { $set: { password }, $inc: { tokenVersion: 1 }, $unset: { ...emailChangeFields, ...resetFields } });
  if (!changed) fail(409, "Your account changed. Log in again before retrying.");
  disconnectUser(user._id);
  await revokeUserSessions(user._id); clearSessionCookie(res);
  res.json({ message: "Password changed. All devices are signed out; log in with your new password.", signedOut: true });
}));

router.post("/logout-all", protect, handle(async (req, res) => {
  const user = await authenticatedPassword(req);
  const changed = await User.findOneAndUpdate(versionFilter(user), { $inc: { tokenVersion: 1 }, $unset: { ...emailChangeFields, ...resetFields } });
  if (!changed) fail(409, "Your account changed. Log in again.");
  disconnectUser(user._id);
  await revokeUserSessions(user._id); clearSessionCookie(res);
  res.json({ message: "All devices are signed out. Log in again to continue.", signedOut: true });
}));

router.post("/email", protect, handle(async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) fail(400, "Enter a valid new email address");
  const user = await authenticatedPassword(req);
  if (email === user.email) fail(400, "Choose a different email address");
  if (!resetDeliveryReady()) fail(503, "Email verification is unavailable. Your current email is unchanged.");
  if (await User.exists({ email })) fail(409, "This email address is unavailable. Choose another address.");
  const token = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const now = new Date();
  const changed = await User.findOneAndUpdate({ ...versionFilter(user), $and: [{ $or: [{ emailChangeRequestedAt: { $exists: false } }, { emailChangeRequestedAt: { $lt: new Date(now.getTime() - 60000) } }] }] }, { $set: { pendingEmail: email, emailChangeTokenHash: hash, emailChangeExpiresAt: new Date(now.getTime() + 30 * 60 * 1000), emailChangeRequestedAt: now } });
  if (!changed) fail(409, "Wait a minute before requesting another link, or log in again if your account changed.");
  try { await sendEmailChangeLink(email, token); }
  catch {
    await User.updateOne({ _id: user._id, emailChangeTokenHash: hash }, { $unset: emailChangeFields });
    fail(503, "The verification message could not be sent. Your email is unchanged; try again later.");
  }
  res.json({ message: resetDeliveryMode() === "local-console" ? "Local demo: the verification link was printed in the backend terminal. No email was sent. Your current email stays unchanged until confirmation." : "A verification link was sent to your new inbox. Your current email stays unchanged until confirmation.", pendingEmail: email });
}));

router.delete("/email", protect, handle(async (req, res) => {
  const changed = await User.updateOne({ _id: req.user._id, tokenVersion: req.user.tokenVersion || 0 }, { $unset: emailChangeFields });
  if (!changed.matchedCount) fail(409, "Your account changed. Log in again.");
  res.json({ message: "Email change cancelled. Your current email is unchanged." });
}));

// The link is a one-time proof of access to the new inbox. GET never consumes it.
router.post("/email/confirm", handle(async (req, res) => {
  const token = req.body?.token;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(400, "Verification link is invalid or expired");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({ emailChangeTokenHash: hash, emailChangeExpiresAt: { $gt: new Date() } }).select("+pendingEmail +emailChangeTokenHash");
  if (!user?.pendingEmail) fail(400, "Verification link is invalid or expired");
  const changed = await User.findOneAndUpdate({ _id: user._id, emailChangeTokenHash: hash, emailChangeExpiresAt: { $gt: new Date() } }, { $set: { email: user.pendingEmail, emailVerifiedAt: new Date() }, $inc: { tokenVersion: 1 }, $unset: { ...emailChangeFields, ...resetFields } });
  if (!changed) fail(400, "Verification link is invalid or expired");
  disconnectUser(user._id);
  await revokeUserSessions(user._id); clearSessionCookie(res);
  res.json({ message: "New email verified and saved. All devices are signed out; log in with your new email.", signedOut: true });
}));

module.exports = router;
