const router = require("express").Router();
const { protect } = require("../middleware/authMiddleware");
const { requestVerification, confirmVerification } = require("../emailVerification");
const handle = action => async (req, res) => { try { res.json(await action(req)); } catch (error) { res.status(error.status || 500).json({ message: error.status ? error.message : "Email verification could not finish" }); } };
router.post("/", protect, handle(req => requestVerification(req.user)));
router.post("/confirm", handle(req => confirmVerification(req.body?.token)));
module.exports = router;
