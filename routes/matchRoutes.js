const express = require("express");
const router = express.Router();
const {
  findMatches,
  assignTalent,
  getTalentProfile,
} = require("../controllers/matchController");
const { protect, requireRole } = require("../middleware/authMiddleware");

router.get("/profile/:id", protect, getTalentProfile);
router.get("/:taskId", protect, requireRole("client"), findMatches);
router.post("/assign", protect, requireRole("client"), assignTalent);

module.exports = router;