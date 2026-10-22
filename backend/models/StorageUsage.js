const mongoose = require("mongoose");
// A bounded ledger makes reservation and release atomic, including concurrent servers.
const schema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  bytes: { type: Number, required: true },
  count: { type: Number, required: true },
  entries: [{ _id: false, key: String, size: Number, createdAt: Date }],
});
module.exports = mongoose.model("StorageUsage", schema);
