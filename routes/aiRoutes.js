const express = require("express");
const router = express.Router();
const { chat, synthesizeSpeech, streamChat, consult } = require("../controllers/aiController");
const { protect, requireRole } = require("../middleware/authMiddleware");

router.post("/chat", protect, requireRole("client"), chat);
router.post("/synthesize", protect, synthesizeSpeech);
router.post("/stream", protect, streamChat);
router.post("/consult", protect, requireRole("client"), consult);

module.exports = router;