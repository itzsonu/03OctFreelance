const express = require("express");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Request = require("../models/SupportRequest");
const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");
const { pagination, envelope } = require("../pagination");
const { storageView } = require("../attachmentStorage");
const publicRouter = express.Router();
const accountRouter = express.Router();
const adminRouter = express.Router();
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const handle = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) { res.status(error.status || (error.code === 11000 ? 409 : 500)).json({ message: error.status ? error.message : error.code === 11000 ? "An active deletion request already exists. Refresh to see it." : "Unable to process this request. Please try again." }); }
};
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const text = (value, min, max, label) => { if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) fail(400, `${label} must contain ${min}–${max} characters`); return value.trim(); };
const view = row => ({ _id: row._id, kind: row.kind, subject: row.subject, message: row.message, email: row.email, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, version: row.__v || 0, history: (row.history || []).map(item => ({ status: item.status, response: item.response, createdAt: item.createdAt })) });
async function createSupport(req, res, owner = null) {
  const subject = text(req.body?.subject, 5, 120, "Subject");
  const message = text(req.body?.message, 10, 4000, "Message");
  const email = owner ? req.user.email : typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) fail(400, "Enter a valid contact email");
  const trackingCode = owner ? null : crypto.randomBytes(32).toString("base64url");
  const row = await Request.create({ owner, kind: "support", email, subject, message, ...(trackingCode ? { trackingHash: digest(trackingCode) } : {}) });
  res.status(201).json({ request: view(row), ...(trackingCode ? { trackingCode } : {}), message: "Request saved for administrator review. No email has been sent." });
}
publicRouter.post("/", handle((req, res) => createSupport(req, res)));
publicRouter.post("/status", handle(async (req, res) => {
  const code = req.body?.trackingCode;
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(code)) fail(404, "Request not found. Check your private tracking code.");
  const row = await Request.findOne({ trackingHash: digest(code), owner: null, kind: "support" }).lean();
  if (!row) fail(404, "Request not found. Check your private tracking code.");
  res.json({ request: view(row) });
}));
accountRouter.use(protect);
accountRouter.get("/storage", handle(async (req, res) => res.json(await storageView(req.user._id))));
accountRouter.post("/support", handle((req, res) => createSupport(req, res, req.user._id)));
accountRouter.get("/support", handle(async (req, res) => {
  const paging = pagination(req.query, 10); const filter = { owner: req.user._id };
  res.json(envelope((await Request.find(filter).sort({ createdAt: -1, _id: -1 }).skip(paging.skip).limit(paging.pageSize).lean()).map(view), await Request.countDocuments(filter), paging));
}));
accountRouter.get("/deletion-request", handle(async (req, res) => {
  const row = await Request.findOne({ owner: req.user._id, kind: "deletion" }).sort({ createdAt: -1, _id: -1 }).lean();
  res.json({ request: row ? view(row) : null });
}));
accountRouter.post("/deletion-request", handle(async (req, res) => {
  if (req.body?.acknowledged !== true) fail(400, "Confirm you understand that this submits a review request");
  const password = req.body?.currentPassword;
  if (typeof password !== "string" || !password || password.length > 128) fail(400, "Enter your current password");
  const user = await User.findById(req.user._id);
  if (!user || !await bcrypt.compare(password, user.password)) fail(400, "Current password is incorrect");
  if ((user.tokenVersion || 0) !== (req.user.tokenVersion || 0)) fail(409, "Your session changed. Log in again.");
  const message = req.body?.message === undefined || req.body.message === "" ? "Please review my account deletion request." : text(req.body.message, 10, 4000, "Reason");
  const row = await Request.create({ owner: user._id, kind: "deletion", email: user.email, subject: "Account deletion request", message });
  res.status(201).json({ request: view(row), message: "Deletion review requested. Your account and project records have not been deleted." });
}));
accountRouter.post("/deletion-request/:id/cancel", handle(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) fail(404, "Request not found");
  const row = await Request.findOneAndUpdate({ _id: req.params.id, owner: req.user._id, kind: "deletion", active: true }, { $set: { status: "cancelled", active: false }, $inc: { __v: 1 }, $push: { history: { actor: req.user._id, status: "cancelled", response: "Cancelled by account owner", createdAt: new Date() } } }, { returnDocument: "after" });
  if (!row) fail(409, "Request is no longer active. Refresh to see its status.");
  res.json({ request: view(row), message: "Deletion request cancelled." });
}));
// Mounted only after admin authentication/role checks in adminRoutes.
adminRouter.get("/support", handle(async (req, res) => {
  const paging = pagination(req.query); const filter = {};
  const status = req.query.status || "open"; const kind = req.query.kind || "all";
  if (!["open", "reviewing", "closed", "cancelled", "all"].includes(status) || !["support", "deletion", "all"].includes(kind)) fail(400, "Invalid request filter");
  if (status !== "all") filter.status = status;
  if (kind !== "all") filter.kind = kind;
  const rows = await Request.find(filter).select("subject kind status email owner createdAt updatedAt").sort({ updatedAt: -1, _id: -1 }).skip(paging.skip).limit(paging.pageSize).lean();
  res.json(envelope(rows, await Request.countDocuments(filter), paging));
}));
adminRouter.get("/support/:id", handle(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) fail(404, "Request not found");
  const row = await Request.findById(req.params.id).lean(); if (!row) fail(404, "Request not found");
  res.json({ request: view(row) });
}));
adminRouter.post("/support/:id", handle(async (req, res) => {
  if (!mongoose.isObjectIdOrHexString(req.params.id)) fail(404, "Request not found");
  const status = req.body?.status;
  if (!["open", "reviewing", "closed"].includes(status)) fail(400, "Choose open, reviewing or closed");
  if (!Number.isSafeInteger(req.body?.version) || req.body.version < 0) fail(400, "Refresh before updating this request");
  const response = text(req.body?.response, 10, 4000, "Response");
  const row = await Request.findOneAndUpdate({ _id: req.params.id, __v: req.body.version, status: { $ne: "cancelled" }, "history.49": { $exists: false } }, { $set: { status, active: status !== "closed" }, $inc: { __v: 1 }, $push: { history: { actor: req.user._id, status, response, createdAt: new Date() } } }, { returnDocument: "after", runValidators: true });
  if (!row) fail(409, "Request changed, was cancelled, or reached its update limit. Refresh before retrying.");
  if (row.owner) await require("../notifications").notifyUser(row.owner, "support", "Support request updated", `Your ${row.kind === "deletion" ? "deletion review" : "support request"} has an update.`, "/support").catch(() => {});
  res.json({ request: view(row), message: row.kind === "deletion" ? "Review updated. This action does not erase account data." : "Response saved. The requester can read it on the support page." });
}));
module.exports = { publicRouter, accountRouter, adminRouter };
