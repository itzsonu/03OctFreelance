const RESET_MESSAGE = "If an account exists for that email, a reset link will arrive shortly.";
const LOCAL_RESET_MESSAGE = "If an account exists for that email, its reset link was printed in the local backend terminal. No email was sent.";
const gmailUser = () => (process.env.GMAIL_USER || "").trim();
const gmailAppPassword = () => (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");

function resetOrigin() {
  try {
    const origin = new URL(process.env.APP_ORIGIN);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) return null;
    if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) return null;
    return { origin: origin.origin, local };
  } catch { return null; }
}

function resetDeliveryMode() {
  const target = resetOrigin();
  if (!target) return "unavailable";
  if (process.env.RESET_DELIVERY === "console") return target.local ? "local-console" : "unavailable";
  if (process.env.RESET_DELIVERY === "gmail") {
    return /^\S+@\S+\.\S+$/.test(gmailUser()) && /^[A-Za-z0-9]{16}$/.test(gmailAppPassword()) ? "email" : "unavailable";
  }
  if (process.env.RESET_DELIVERY === "brevo") return process.env.BREVO_API_KEY?.trim() && /^\S+@\S+\.\S+$/.test(process.env.RESET_FROM_EMAIL || "") ? "email" : "unavailable";
  if (process.env.RESET_DELIVERY) return "unavailable";
  return process.env.RESEND_API_KEY && process.env.RESET_FROM_EMAIL ? "email" : "unavailable";
}

const resetDeliveryReady = () => resetDeliveryMode() !== "unavailable";

async function sendSecurityEmail(email, token, { pathname = "/reset-password", purpose = "password reset", subject = "Reset your FreelanceChain password", instruction = "Use this link to reset your password within 15 minutes:" } = {}, { createTransport } = {}) {
  const target = resetOrigin();
  if (!target || !resetDeliveryReady()) throw new Error("Password reset email is not configured");
  const link = new URL(pathname, target.origin);
  link.searchParams.set("token", token);

  if (process.env.RESET_DELIVERY === "console") {
    console.log(`Local ${purpose} link for ${email}: ${link}`);
    return;
  }

  return sendEmailContent(email, subject, `${instruction}\n${link}\n\nIf you did not request this, ignore this email.`, { createTransport });
}

async function sendEmailContent(email, subject, text, { createTransport, idempotencyKey } = {}) {

  if (process.env.RESET_DELIVERY === "gmail") {
    const transport = (createTransport || require("nodemailer").createTransport)({
      service: "gmail",
      auth: { user: gmailUser(), pass: gmailAppPassword() },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
    try {
      await transport.sendMail({
        from: `FreelanceChain <${gmailUser()}>`,
        to: email,
        subject,
        text,
      });
    } finally {
      transport.close?.();
    }
    return;
  }

  if (process.env.RESET_DELIVERY === "brevo") {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY.trim(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender: { name: "FreelanceChain", email: process.env.RESET_FROM_EMAIL }, to: [{ email }], subject, textContent: text }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Email provider rejected delivery (status " + response.status + ")");
    const receipt = await response.json();
    if (!receipt?.messageId) throw new Error("Email provider did not acknowledge delivery");
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: JSON.stringify({
      from: process.env.RESET_FROM_EMAIL,
      to: [email],
      subject,
      text,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Password reset email failed with status ${response.status}`);
}

function sendVerificationEmail(email, token, options) { return sendSecurityEmail(email, token, { pathname: "/verify-email", purpose: "account email verification", subject: "Verify your FreelanceChain email", instruction: "Confirm your FreelanceChain sign-in email within 30 minutes:" }, options); }

function sendResetEmail(email, token, options) { return sendSecurityEmail(email, token, {}, options); }
function sendEmailChangeLink(email, token, options) { return sendSecurityEmail(email, token, { pathname: "/account/verify-email", purpose: "email verification", subject: "Verify your new FreelanceChain email", instruction: "Confirm your new FreelanceChain email within 30 minutes:" }, options); }

async function sendEventEmail(email, notification, options = {}) {
  const target = resetOrigin();
  const mode = resetDeliveryMode();
  if (!target || mode === "unavailable") throw new Error("Event email delivery unavailable");
  const path = notification.link;
  if (typeof path !== "string" || !/^\/(?:client-dashboard|freelancer-dashboard|milestones\/[a-f0-9]{24})$/.test(path)) throw new Error("Invalid notification email link");
  const link = new URL(path, target.origin);
  const preferences = new URL("/account", target.origin);
  const subject = `FreelanceChain: ${notification.title.replace(/[\r\n]/g, " ")}`;
  const text = `${notification.body}\n\nOpen FreelanceChain: ${link}\n\nYou enabled this type of email alert. Change your preferences: ${preferences}\nSign in to view private project details. Do not reply to this automated message.`;
  if (mode === "local-console") { console.log(`Local event email preview (no email sent) to ${email}:\n${subject}\n${text}`); return mode; }
  await sendEmailContent(email, subject, text, { ...options, idempotencyKey: `event-${notification._id}` });
  return mode;
}

module.exports = { sendVerificationEmail, sendEventEmail, sendEmailChangeLink, RESET_MESSAGE, LOCAL_RESET_MESSAGE, resetDeliveryMode, resetDeliveryReady, sendResetEmail };
