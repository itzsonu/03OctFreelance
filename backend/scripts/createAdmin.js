require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const fs = require("node:fs/promises");
const { databaseUriWithPassword } = require("../deployment");

async function createAdmin(env = process.env) {
  const name = typeof env.ADMIN_NAME === "string" ? env.ADMIN_NAME.trim() : "";
  const email = typeof env.ADMIN_EMAIL === "string" ? env.ADMIN_EMAIL.trim().toLowerCase() : "";
  const password = typeof env.ADMIN_PASSWORD === "string" ? env.ADMIN_PASSWORD : "";
  if (!name || name.length < 2 || name.length > 100) throw new Error("Set ADMIN_NAME to a name of 2–100 characters");
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error("Set ADMIN_EMAIL to a valid email address");
  if (password.length < 12 || password.length > 128) throw new Error("Set ADMIN_PASSWORD to a password of 12–128 characters");
  const database = {};
  for (const key of ["MONGO_URI", "MONGO_PASSWORD"]) {
    if (env[key] && env[key + "_FILE"]) throw new Error("Configure only " + key + " or " + key + "_FILE");
    database[key] = env[key + "_FILE"] ? (await fs.readFile(env[key + "_FILE"], "utf8")).trim() : env[key];
  }
  if (!database.MONGO_URI) throw new Error("MONGO_URI is required");
  const uri = database.MONGO_PASSWORD !== undefined ? databaseUriWithPassword(database.MONGO_URI, database.MONGO_PASSWORD) : database.MONGO_URI;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
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
    const safe = /^(Set ADMIN_|MONGO_|Configure only |An account with this email|Separate database|Use a valid MongoDB|Use a URI|Database username)/.test(error.message);
    console.error(safe ? error.message : "Admin creation failed. Check database access, network permissions and whether the email already exists.");
    process.exitCode = 1;
  });
}

module.exports = { createAdmin };
