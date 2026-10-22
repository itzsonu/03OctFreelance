const mongoose = require("mongoose");
function encode(message) { return message ? Buffer.from(JSON.stringify([new Date(message.createdAt).toISOString(), String(message._id)])).toString("base64url") : null; }
function decode(value) {
  if (typeof value !== "string" || value.length > 180 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid message cursor");
  let parsed;
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); } catch { throw new Error("Invalid message cursor"); }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || !/^[a-f0-9]{24}$/.test(parsed[1]) || Number.isNaN(Date.parse(parsed[0])) || new Date(parsed[0]).toISOString() !== parsed[0]) throw new Error("Invalid message cursor");
  return { createdAt: new Date(parsed[0]), id: new mongoose.Types.ObjectId(parsed[1]) };
}
module.exports = { encode, decode };
