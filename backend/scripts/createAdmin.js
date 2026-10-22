require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");

async function createAdmin(env = process.env) {
  const name = typeof env.ADMIN_NAME === "string" ? env.ADMIN_NAME.trim() : "";
  const email = typeof env.ADMIN_EMAIL === "string" ? env.ADMIN_EMAIL.trim().toLowerCase() : "";
  const password = typeof env.ADMIN_PASSWORD === "string" ? env.ADMIN_PASSWORD : "";
  if (!name || name.length < 2 || name.length > 100) throw new Error("Set ADMIN_NAME to a name of 2–100 characters");
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error("Set ADMIN_EMAIL to a valid email address");
  if (password.length < 12 || password.length > 128) throw new Error("Set ADMIN_PASSWORD to a password of 12–128 characters");
  if (!env.MONGO_URI) throw new Error("MONGO_URI is required");

  await mongoose.connect(env.MONGO_URI);
  try {
    if (await User.exists({ email })) throw new Error("An account with this email already exists; this command never promotes an existing account");
    const user = await User.create({ name, email, password: await bcrypt.hash(password, 12), role: "admin" });
    console.log(`Admin account created. User ID: ${user._id}`);
    return user;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  createAdmin().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createAdmin };
