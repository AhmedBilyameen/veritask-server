const express = require("express");
const router = express.Router();
const {
  createTask, getPricingGuidance, getMyTasks, getTaskById, updateTaskStatus,
  getAllOpenTasks, getAssignedTasks,
  acceptOffer, declineOffer, resendOffer, cancelOffer,
  fundProject, submitWork, beginReview, requestRevision, approveWork,
  getAdminRecentTasks, getAdminAllTasks, getAdminEscrowSummary,
  updateTask, deleteTask,
  // legacy aliases
  acceptTask, declineTask, markTaskComplete, confirmTaskComplete,
} = require("../controllers/taskController");
const { protect, requireRole } = require("../middleware/authMiddleware");

// ── Open / listing
router.get("/pricing-guidance", protect, getPricingGuidance);
router.get("/open", protect, getAllOpenTasks);
router.get("/my", protect, getMyTasks);
router.get("/assigned", protect, requireRole("talent"), getAssignedTasks);

// ── Admin
router.get("/admin/recent", protect, requireRole("admin"), getAdminRecentTasks);
router.get("/admin/all", protect, requireRole("admin"), getAdminAllTasks);
router.get("/admin/escrow", protect, requireRole("admin"), getAdminEscrowSummary);

// ── Create
router.post("/", protect, requireRole("client"), createTask);

// ── Single task
router.get("/:id", protect, getTaskById);
router.patch("/:id/status", protect, updateTaskStatus);

// ── Full lifecycle (new)
router.patch("/:taskId/accept", protect, requireRole("talent"), acceptOffer);
router.patch("/:taskId/decline", protect, requireRole("talent"), declineOffer);
router.patch("/:taskId/resend", protect, requireRole("client"), resendOffer);
router.patch("/:taskId/cancel", protect, requireRole("client"), cancelOffer);
router.patch("/:taskId/fund", protect, requireRole("client"), fundProject);
router.patch("/:taskId/submit", protect, requireRole("talent"), submitWork);
router.patch("/:taskId/begin-review", protect, requireRole("client"), beginReview);
router.patch("/:taskId/request-revision", protect, requireRole("client"), requestRevision);
router.patch("/:taskId/approve", protect, requireRole("client"), approveWork);

// ── Legacy aliases (kept for backward compat)
router.patch("/:taskId/complete", protect, requireRole("talent"), markTaskComplete);
router.patch("/:taskId/confirm", protect, requireRole("client"), confirmTaskComplete);

// ── Edit / delete
router.patch("/:taskId", protect, requireRole("client"), updateTask);
router.delete("/:taskId", protect, requireRole("client"), deleteTask);

module.exports = router;