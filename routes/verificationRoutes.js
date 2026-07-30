const express = require("express");
const router = express.Router();
const {
    getVerificationStatus,
    getAssessmentLaunchUrl,
    receiveAssessmentWebhook,
    skipAssessment,
    submitPortfolio,
    submitCV,
    adminReviewStage,
    getAdminVerificationQueue,
    getVerificationDetail,
} = require("../controllers/verificationController");
const { protect, requireRole } = require("../middleware/authMiddleware");

// ── Talent routes ──────────────────────────────────────────────────────────────
router.get("/status", protect, requireRole("talent"), getVerificationStatus);

// Assessment orchestrator — get redirect URL & receive results from external platform
router.post("/assessment/launch", protect, requireRole("talent"), getAssessmentLaunchUrl);
router.post("/assessment/skip", protect, requireRole("talent"), skipAssessment);
router.post("/assessment/webhook", receiveAssessmentWebhook);  // No auth — verified by shared secret

router.post("/portfolio", protect, requireRole("talent"), submitPortfolio);
router.post("/cv", protect, requireRole("talent"), submitCV);

// ── Admin routes ───────────────────────────────────────────────────────────────
router.post("/admin/review", protect, requireRole("admin"), adminReviewStage);
router.get("/admin/queue", protect, requireRole("admin"), getAdminVerificationQueue);
router.get("/admin/detail/:talentId", protect, requireRole("admin"), getVerificationDetail);
router.get("/detail/:talentId", protect, requireRole("client", "admin"), getVerificationDetail);

module.exports = router;

