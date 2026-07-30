const express = require("express");
const router = express.Router();
const { submitReview, getTalentReviews, getAdminReviews } = require("../controllers/reviewController");
const { protect, requireRole } = require("../middleware/authMiddleware");

router.post("/", protect, requireRole("client"), submitReview);
router.get("/admin", protect, requireRole("admin"), getAdminReviews);
router.get("/:talentId", protect, getTalentReviews);

module.exports = router;