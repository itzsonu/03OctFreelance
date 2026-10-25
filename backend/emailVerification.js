const crypto = require("node:crypto");
const User = require("./models/User");
const { resetDeliveryReady, sendVerificationEmail } = require("./resetMail");
const { verificationFields: fields } = require("./accountSecurity");
const hash = token => crypto.createHash("sha256").update(token).digest("hex");
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
async function requestVerification(user) {
  if (user.emailVerifiedAt) return { message: "Your sign-in email is already verified." };
  if (!resetDeliveryReady()) fail(503, "Email verification is unavailable right now. Try again later.");
  const token = crypto.randomBytes(32).toString("base64url"), digest = hash(token), now = new Date();
  const changed = await User.findOneAndUpdate({ _id: user._id, email: user.email, emailVerifiedAt: null, $or: [{ emailVerificationRequestedAt: { $exists: false } }, { emailVerificationRequestedAt: { $lt: new Date(now.getTime() - 60000) } }] }, { $set: { emailVerificationTokenHash: digest, emailVerificationEmail: user.email, emailVerificationExpiresAt: new Date(now.getTime() + 30 * 60000), emailVerificationRequestedAt: now } });
  if (!changed) fail(429, "Wait a minute before requesting another verification email.");
  try { await sendVerificationEmail(user.email, token); }
  catch { await User.updateOne({ _id: user._id, emailVerificationTokenHash: digest }, { $unset: { emailVerificationTokenHash: "", emailVerificationEmail: "", emailVerificationExpiresAt: "" } }); fail(503, "The verification email could not be sent. Try again later."); }
  return { message: "A verification link was sent to your sign-in inbox. It expires after 30 minutes." };
}
async function confirmVerification(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(400, "Verification link is invalid or expired");
  const digest = hash(token);
  const user = await User.findOne({ emailVerificationTokenHash: digest, emailVerificationExpiresAt: { $gt: new Date() } }).select("+emailVerificationEmail");
  if (!user || user.email !== user.emailVerificationEmail) fail(400, "Verification link is invalid or expired");
  const changed = await User.updateOne({ _id: user._id, email: user.emailVerificationEmail, emailVerifiedAt: null, emailVerificationTokenHash: digest, emailVerificationExpiresAt: { $gt: new Date() } }, { $set: { emailVerifiedAt: new Date() }, $unset: fields });
  if (!changed.modifiedCount) fail(400, "Verification link is invalid or expired");
  return { message: "Your sign-in email is verified." };
}
module.exports = { requestVerification, confirmVerification };
