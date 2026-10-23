const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  _id: String,
  bytes: { type: Number, required: true },
  count: { type: Number, required: true },
  entries: [{ _id: false, key: String, size: Number, createdAt: Date }],
});
module.exports = mongoose.model("PrivateStoragePool", schema);
