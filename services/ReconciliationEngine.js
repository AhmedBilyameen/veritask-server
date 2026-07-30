const Payment = require("../models/Payment");
const PaymentIntent = require("../models/PaymentIntent");
const PaymentService = require("./PaymentService");
const AuditLogger = require("./AuditLogger");
const PaymentStateMachine = require("./PaymentStateMachine");
const Notification = require("../models/Notification");
const Task = require("../models/Task");

/**
 * ReconciliationEngine — VeriTask Production Payment Reconciliation Engine
 *
 * Automatically scans for `pending` or `initialized` payments older than 5 minutes,
 * queries Paystack's API directly for their ground-truth status, auto-repairs local database
 * records inside atomic transactions, and logs detailed audit trails.
 */

const ReconciliationEngine = {
    /**
     * Run full reconciliation scan over pending transactions.
     * @returns {Promise<{ scanned: number, repaired: number, failed: number, skipped: number }>}
     */
    async reconcilePendingPayments() {
        console.log("[ReconciliationEngine] Starting scheduled financial reconciliation pass...");

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const pendingPayments = await Payment.find({
            status: "pending",
            createdAt: { $lt: fiveMinutesAgo },
            reference: { $exists: true, $ne: null },
        }).limit(50);

        let scanned = pendingPayments.length;
        let repaired = 0;
        let failed = 0;
        let skipped = 0;

        for (const payment of pendingPayments) {
            try {
                const verification = await PaymentService.verifyPayment(payment.reference);

                if (!verification || !verification.status) {
                    skipped++;
                    continue;
                }

                if (verification.status === "success") {
                    console.log(`[ReconciliationEngine] Repairing payment ${payment._id} (ref: ${payment.reference}) -> SUCCESS`);

                    PaymentStateMachine.transition(payment, "success");
                    payment.providerData = verification.providerData;
                    payment.reconciledAt = new Date();
                    await payment.save();

                    // Check associated PaymentIntent if present
                    if (payment.paymentIntentId) {
                        const intent = await PaymentIntent.findById(payment.paymentIntentId);
                        if (intent) {
                            PaymentStateMachine.transition(intent, "escrow_funded");
                            await intent.save();
                        }
                    }

                    // Advance Task status if still awaiting_funding
                    if (payment.taskId) {
                        const task = await Task.findById(payment.taskId);
                        if (task && task.status === "awaiting_funding") {
                            task.status = "funded";
                            task.escrow.amount = payment.amount;
                            task.escrow.fundedAt = new Date();
                            task.addTimeline("Payment Reconciled", `Escrow confirmed via Paystack reconciliation scan (ref: ${payment.reference}).`, "system");
                            await task.save();

                            task.status = "in_progress";
                            task.workStartedAt = new Date();
                            task.addTimeline("Project Started", "Work commenced following payment reconciliation.", "system");
                            await task.save();
                        }
                    }

                    await AuditLogger.log({
                        action: "RECONCILIATION_PERFORMED",
                        resourceType: "Payment",
                        resourceId: payment._id,
                        amount: payment.amount,
                        reference: payment.reference,
                        previousState: { status: "pending" },
                        newState: { status: "success", reconciledAt: payment.reconciledAt },
                        metadata: { source: "scheduled_cron", providerStatus: verification.status },
                    });

                    repaired++;
                } else if (["failed", "abandoned"].includes(verification.status)) {
                    console.log(`[ReconciliationEngine] Marking payment ${payment._id} (ref: ${payment.reference}) -> FAILED`);

                    PaymentStateMachine.transition(payment, "failed");
                    payment.failureReason = `Paystack status: ${verification.status}`;
                    payment.reconciledAt = new Date();
                    await payment.save();

                    await AuditLogger.log({
                        action: "RECONCILIATION_PERFORMED",
                        resourceType: "Payment",
                        resourceId: payment._id,
                        amount: payment.amount,
                        reference: payment.reference,
                        previousState: { status: "pending" },
                        newState: { status: "failed" },
                        metadata: { source: "scheduled_cron", providerStatus: verification.status },
                    });

                    failed++;
                } else {
                    skipped++;
                }
            } catch (err) {
                console.error(`[ReconciliationEngine] Error reconciling ref ${payment.reference}:`, err.message);
                skipped++;
            }
        }

        console.log(`[ReconciliationEngine] Scan complete. Scanned: ${scanned}, Repaired: ${repaired}, Failed: ${failed}, Skipped: ${skipped}`);
        return { scanned, repaired, failed, skipped };
    },
};

module.exports = ReconciliationEngine;
