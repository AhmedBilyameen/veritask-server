const express = require("express");
const router = express.Router();
const {
    handlePaystackWebhook,
    createPaymentIntent,
    initiateEscrow,
    verifyPayment,
    getPaymentReceipt,
    adminTriggerReconciliation,
    getPaymentHistory,
    getPaymentSummary,
    adminGetAllPayments,
    adminGetWebhookEvents,
} = require("../controllers/paymentController");
const { protect, requireRole } = require("../middleware/authMiddleware");

// ── Webhook — Paystack sends events here (NO auth, signature-verified internally)
router.post("/webhook", handlePaystackWebhook);

// ── Payment Intent, Verification & Escrow Initiation
router.get("/verify/:reference", protect, verifyPayment);
router.post("/create-intent", protect, requireRole("client"), createPaymentIntent);
router.post("/initiate-escrow", protect, requireRole("client"), initiateEscrow);

// ── Payment Receipts (PDF / HTML / JSON)
router.get("/:id/receipt", protect, getPaymentReceipt);

// ── All authenticated users: payment history & summary
router.get("/history", protect, getPaymentHistory);
router.get("/summary", protect, getPaymentSummary);

// ── Admin: full ledger view, webhook logs & manual reconciliation trigger
router.get("/admin", protect, requireRole("admin"), adminGetAllPayments);
router.get("/admin/webhooks", protect, requireRole("admin"), adminGetWebhookEvents);
router.post("/admin/reconcile", protect, requireRole("admin"), adminTriggerReconciliation);

module.exports = router;
