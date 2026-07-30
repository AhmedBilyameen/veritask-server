const express = require("express");
const router = express.Router();
const {
    getWallet, requestWithdrawal,
    getAdminWallets, adminAdjustWallet, updateWithdrawalStatus,
} = require("../controllers/walletController");
const { protect, requireRole } = require("../middleware/authMiddleware");

// Talent routes
router.get("/", protect, getWallet);
router.post("/withdraw", protect, requireRole("talent"), requestWithdrawal);

// Admin routes
router.get("/admin", protect, requireRole("admin"), getAdminWallets);
router.post("/admin/:userId/adjust", protect, requireRole("admin"), adminAdjustWallet);

// Admin: update withdrawal status   pending → processing → completed | failed
router.patch("/admin/:userId/withdrawals/:withdrawalIndex/status", protect, requireRole("admin"), updateWithdrawalStatus);

module.exports = router;
