const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const User = require("../models/User");
const { RESET_MESSAGE, LOCAL_RESET_MESSAGE, resetDeliveryMode, resetDeliveryReady, sendResetEmail } = require("../resetMail");

const { emailChangeFields, passwordError } = require("../accountSecurity");
const { disconnectUser } = require("../liveUpdates");
const router = express.Router();
const authAttempts = new Map();

function limitAttempts(kind, max) {
  return (req, res, next) => {
    const key = `${kind}:${req.ip}`;
    const now = Date.now();
    const current = authAttempts.get(key);
    const entry = !current || current.until <= now ? { count: 0, until: now + 15 * 60 * 1000 } : current;
    entry.count += 1;
    authAttempts.set(key, entry);
    if (authAttempts.size > 10000) authAttempts.delete(authAttempts.keys().next().value);
    if (entry.count > max) return res.status(429).json({ message: "Too many attempts. Please try again later." });
    next();
  };
}

router.post("/register", limitAttempts("register", 10), async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!["client", "freelancer"].includes(role)) {
      return res.status(400).json({ message: "Choose a valid account type" });
    }
    if (passwordError(password)) {
      return res.status(400).json({ message: passwordError(password) });
    }
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (normalizedName.length < 2 || normalizedName.length > 100 || normalizedEmail.length > 254 || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return res.status(400).json({ message: "Enter a valid name and email" });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name: normalizedName,
      email: normalizedEmail,
      password: hashedPassword,
      role,
    });

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: "User already exists" });
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", limitAttempts("login", 20), async (req, res) => {
  try {
    const { email, password, role } = req.body || {};

    if (typeof email !== "string" || !email.trim() || email.length > 254 || typeof password !== "string" || !password || !["client", "freelancer", "admin"].includes(role)) {
      return res.status(400).json({ message: "Email, password and role are required" });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase(), role });

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role, version: user.tokenVersion || 0 },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/recovery-status", (_req, res) => res.json({ mode: resetDeliveryMode() }));

router.post("/forgot-password", limitAttempts("request", 5), async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return res.status(400).json({ message: "Enter a valid email address" });
  }
  if (!resetDeliveryReady()) {
    return res.status(503).json({ message: "Password recovery is unavailable right now. Please try again later." });
  }
  try {
    const user = await User.findOne({ email }).select("+passwordResetRequestedAt");
    if (user) {
      const token = crypto.randomBytes(32).toString("base64url");
      const hash = crypto.createHash("sha256").update(token).digest("hex");
      const now = new Date();
      const cutoff = new Date(now.getTime() - 60 * 1000);
      const updated = await User.findOneAndUpdate(
        { _id: user._id, $or: [{ passwordResetRequestedAt: { $exists: false } }, { passwordResetRequestedAt: { $lt: cutoff } }] },
        { $set: { passwordResetTokenHash: hash, passwordResetExpiresAt: new Date(now.getTime() + 15 * 60 * 1000), passwordResetRequestedAt: now } },
      );
      if (updated) {
        try {
          await sendResetEmail(email, token);
        } catch (error) {
          console.error("Password reset email delivery failed:", error.message);
          await User.updateOne({ _id: user._id, passwordResetTokenHash: hash }, { $unset: { passwordResetTokenHash: "", passwordResetExpiresAt: "", passwordResetRequestedAt: "" } });
        }
      }
    }
    res.json({ message: resetDeliveryMode() === "local-console" ? LOCAL_RESET_MESSAGE : RESET_MESSAGE });
  } catch (error) {
    console.error("Password reset request failed:", error.message);
    res.status(500).json({ message: "Unable to process password recovery right now." });
  }
});

router.post("/reset-password", limitAttempts("confirm", 10), async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  const password = req.body?.password;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(400).json({ message: "Reset link is invalid or expired." });
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: "Password must have 8–128 characters" });
  }
  try {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.findOneAndUpdate(
      { passwordResetTokenHash: hash, passwordResetExpiresAt: { $gt: new Date() } },
      { $set: { password: hashedPassword }, $inc: { tokenVersion: 1 }, $unset: { ...emailChangeFields, passwordResetTokenHash: "", passwordResetExpiresAt: "", passwordResetRequestedAt: "" } },
    );
    if (!user) return res.status(400).json({ message: "Reset link is invalid or expired." });
    disconnectUser(user._id);
    res.json({ message: "Password updated. Log in with your new password." });
  } catch (error) {
    console.error("Password reset failed:", error.message);
    res.status(500).json({ message: "Unable to reset password right now." });
  }
});

module.exports = router;
