const router = require("express").Router();
const { limits } = require("../attachmentStorage");
const maintenance = require("../storageMaintenance");
const Attachment = require("../models/Attachment");
const Cleanup = require("../models/StorageCleanup");
const handle = action => async (req, res) => { try { await action(req, res); } catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : "Storage maintenance is unavailable. No further cleanup was attempted; check the audit history before retrying." }); } };
router.get("/storage", handle(async (req, res) => {
  const totals = await Attachment.aggregate([{ $group: { _id: null, bytes: { $sum: "$size" }, files: { $sum: 1 } } }]);
  res.json({ ...limits(), shared: require("../fileStorage").storageBackend() === "mongo" ? await require("../mongoFileStorage").view() : null, recordedBytes: totals[0]?.bytes || 0, recordedFiles: totals[0]?.files || 0, graceHours: 24, history: await Cleanup.find().select("actor status createdAt appliedAt removedFiles releasedReservations skipped").sort({ createdAt: -1 }).limit(10).lean() });
}));
router.post("/storage/preview", handle(async (req, res) => res.json(await maintenance.preview(req.user._id))));
router.post("/storage/cleanup", handle(async (req, res) => res.json(await maintenance.apply(req.user._id, req.body?.token))));
module.exports = router;
