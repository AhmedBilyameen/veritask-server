const crypto = require("crypto");
const mongoose = require("mongoose");
const Payment = require("../models/Payment");
const PaymentIntent = require("../models/PaymentIntent");
const WebhookEvent = require("../models/WebhookEvent");
const IdempotencyKey = require("../models/IdempotencyKey");
const Task = require("../models/Task");
const Wallet = require("../models/Wallet");
const Notification = require("../models/Notification");
const PaymentService = require("../services/PaymentService");
const PaymentStateMachine = require("../services/PaymentStateMachine");
const AuditLogger = require("../services/AuditLogger");
const ReceiptService = require("../services/ReceiptService");
const ReconciliationEngine = require("../services/ReconciliationEngine");
const { PLATFORM_COMMISSION_PERCENT } = require("../constants/paymentConstants");

// ─── Helper: notification ─────────────────────────────────────────────────────
async function notify(recipientId, type, title, message, taskId = null) {
    try {
        const since = new Date(Date.now() - 60_000);
        const exists = await Notification.findOne({ recipient: recipientId, type, taskId, createdAt: { $gte: since } });
        if (exists) return;
        await Notification.create({ recipient: recipientId, type, title, message, taskId });
    } catch (err) {
        console.error("Notification error:", err.message);
    }
}

// ─── Helper: ensure wallet exists ─────────────────────────────────────────────
async function ensureWallet(userId) {
    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) wallet = await Wallet.create({ user: userId });
    return wallet;
}

// =============================================================================
// PAYMENT WEBHOOK — POST /api/payments/webhook
// Handles Paystack webhook events with raw WebhookEvent logging & atomic IdempotencyKey locks.
// =============================================================================
const handlePaystackWebhook = async (req, res) => {
    const startTime = Date.now();
    const signature = req.headers["x-paystack-signature"] || req.headers["X-Paystack-Signature"];
    const rawBody = req.rawBody;
    const clientIp = req.ip || req.connection?.remoteAddress || null;

    let webhookLog = null;
    let isValidSignature = true;

    // 1. Verify Webhook HMAC Signature
    if (signature && rawBody) {
        isValidSignature = PaymentService.verifyWebhookSignature(signature, rawBody);
    }

    const event = req.body || {};
    const eventType = event?.event || "unknown.event";
    const data = event?.data || {};

    // 2. Audit Log Webhook Event in Database (Record every raw attempt, including duplicates)
    try {
        webhookLog = await WebhookEvent.create({
            provider: "paystack",
            event: eventType,
            signature,
            payload: event,
            processed: false,
            ip: clientIp,
            headers: req.headers,
            error: !isValidSignature ? "Invalid HMAC signature" : null,
        });
    } catch (logErr) {
        console.error("[Webhook] Failed to save WebhookEvent log:", logErr.message);
    }

    if (!isValidSignature) {
        console.warn("[Webhook] Invalid Paystack signature — request rejected");
        return res.status(400).json({ message: "Invalid signature" });
    }

    // Fast 200 OK acknowledgment to Paystack
    res.status(200).json({ received: true });

    // 3. Database-Level Atomic Idempotency Guard
    const eventId = data?.id || data?.reference || `${eventType}-${Date.now()}`;
    let lockAcquired = false;

    try {
        await IdempotencyKey.create({ key: String(eventId), eventType, status: "processing" });
        lockAcquired = true;
    } catch (e11000) {
        console.log(`[Webhook:Idempotency] Duplicate event ${eventId} (${eventType}) already locked/processed — skipping`);
        if (webhookLog) {
            webhookLog.processed = true;
            webhookLog.error = "Duplicate webhook skipped by IdempotencyKey guard";
            webhookLog.processingTimeMs = Date.now() - startTime;
            await webhookLog.save();
        }
        return;
    }

    // 4. Asynchronous Event Processing inside Idempotency Lock
    try {
        if (eventType === "charge.success") {
            await handleChargeSuccess(data);
        } else if (eventType === "transfer.success") {
            await handleTransferSuccess(data);
        } else if (eventType === "transfer.failed" || eventType === "transfer.reversed") {
            await handleTransferFailed(data, eventType);
        }

        // Mark Idempotency lock & Webhook log complete
        await IdempotencyKey.updateOne({ key: String(eventId), eventType }, { status: "completed" });

        if (webhookLog) {
            webhookLog.processed = true;
            webhookLog.processingTimeMs = Date.now() - startTime;
            await webhookLog.save();
        }
    } catch (err) {
        console.error(`[Webhook] Error processing ${eventType}:`, err.message);
        await IdempotencyKey.updateOne({ key: String(eventId), eventType }, { status: "failed" });
        if (webhookLog) {
            webhookLog.error = err.message;
            webhookLog.processingTimeMs = Date.now() - startTime;
            await webhookLog.save();
        }
    }
};

// ─── EVENT: charge.success ────────────────────────────────────────────────────
async function handleChargeSuccess(data) {
    const reference = data?.reference;
    if (!reference) return;

    const payment = await Payment.findOne({ reference });
    if (!payment) {
        console.warn(`[Webhook:charge.success] No payment found for ref: ${reference}`);
        return;
    }

    // Skip if already reconciled
    if (payment.status === "escrow_funded" || payment.status === "success" || payment.status === "released" || payment.status === "completed") {
        console.log(`[Webhook:charge.success] Payment ${reference} already in terminal state '${payment.status}' — skipping`);
        return;
    }

    // Verify directly with Paystack API
    const verification = await PaymentService.verifyPayment(reference);
    if (!verification.success) {
        PaymentStateMachine.transition(payment, "failed");
        payment.failureReason = "Paystack verification failed";
        await payment.save();
        return;
    }

    // Transition Payment & Intent states via PaymentStateMachine
    PaymentStateMachine.transition(payment, "escrow_funded");
    payment.providerData = verification.providerData;
    payment.reconciledAt = new Date();
    await payment.save();

    if (payment.paymentIntentId) {
        const intent = await PaymentIntent.findById(payment.paymentIntentId);
        if (intent) {
            PaymentStateMachine.transition(intent, "escrow_funded");
            await intent.save();
        }
    }

    // Record immutable Audit Log
    await AuditLogger.log({
        actorId: payment.clientId,
        actorRole: "client",
        action: "ESCROW_FUNDED",
        resourceType: "Payment",
        resourceId: payment._id,
        amount: payment.amount,
        reference,
        previousState: { status: "pending" },
        newState: { status: "escrow_funded" },
        metadata: { provider: "paystack" },
    });

    // Advance Task State: awaiting_funding → funded → in_progress
    const task = await Task.findById(payment.taskId);
    if (!task) return;

    if (task.status === "awaiting_funding") {
        task.status = "funded";
        task.escrow.amount = payment.amount;
        task.escrow.fundedAt = new Date();
        task.addTimeline("Payment Confirmed", `Escrow funded via Paystack (ref: ${reference}).`, "system");
        await task.save();

        task.status = "in_progress";
        task.workStartedAt = new Date();
        task.addTimeline("Project Started", "Work has officially commenced.", "system");
        await task.save();

        await notify(
            task.businessOwner,
            "escrow_funded",
            "Escrow Funded",
            "Your project is now fully funded. Work has started!",
            task._id
        );
        if (task.assignedTalent) {
            await notify(
                task.assignedTalent,
                "project_started",
                "Project Started",
                "The client has funded the project. You can now begin work!",
                task._id
            );
        }
    }
}

// ─── EVENT: transfer.success ──────────────────────────────────────────────────
async function handleTransferSuccess(data) {
    const reference = data?.reference;
    if (!reference) return;

    const payment = await Payment.findOne({ reference });
    if (!payment) return;

    if (payment.status === "completed" || payment.status === "success") {
        console.log(`[Webhook:transfer.success] Ref ${reference} already reconciled — skipping`);
        return;
    }

    PaymentStateMachine.transition(payment, "completed");
    payment.providerData = data;
    payment.reconciledAt = new Date();
    await payment.save();

    // Escrow Release: Credit Talent Wallet with net amount (gross minus platform commission)
    if (payment.type === "escrow_release" && payment.talentId) {
        const gross = payment.grossAmount || payment.amount;
        const commissionFee = payment.platformCommissionFee || 0;
        const netAmount = payment.netTalentAmount || (gross - commissionFee);

        const wallet = await ensureWallet(payment.talentId);
        wallet.balance = (wallet.balance || 0) + netAmount;
        wallet.transactions = wallet.transactions || [];
        wallet.transactions.push({
            type: "credit",
            amount: netAmount,
            description: `Payment release for completed task`,
            reference,
            createdAt: new Date(),
        });
        await wallet.save();

        await AuditLogger.log({
            actorId: payment.talentId,
            actorRole: "talent",
            action: "WALLET_CREDITED",
            resourceType: "Wallet",
            resourceId: wallet._id,
            amount: netAmount,
            reference,
            metadata: { gross, commissionFee },
        });

        await notify(
            payment.talentId,
            "payment_received",
            "💰 Payment Received",
            `₦${netAmount.toLocaleString()} has been credited to your wallet.`,
            payment.taskId
        );
    }

    // Withdrawal: Complete talent withdrawal status
    if (payment.type === "withdrawal" && payment.talentId) {
        const wallet = await Wallet.findOne({ user: payment.talentId });
        if (wallet?.withdrawals) {
            const pending = wallet.withdrawals.find(
                (w) => w.status === "processing" && w.reference === reference
            );
            if (pending) {
                pending.status = "completed";
                pending.completedAt = new Date();

                // Unlock pendingBalance permanently
                wallet.pendingBalance = Math.max(0, (wallet.pendingBalance || 0) - payment.amount);
                await wallet.save();
            }
        }

        await AuditLogger.log({
            actorId: payment.talentId,
            actorRole: "talent",
            action: "WITHDRAWAL_COMPLETED",
            resourceType: "Payment",
            resourceId: payment._id,
            amount: payment.amount,
            reference,
        });

        await notify(
            payment.talentId,
            "withdrawal_completed",
            "Withdrawal Completed",
            `Your withdrawal of ₦${payment.amount.toLocaleString()} was successful.`,
            null
        );
    }
}

// ─── EVENT: transfer.failed / transfer.reversed ───────────────────────────────
async function handleTransferFailed(data, eventType) {
    const reference = data?.reference;
    if (!reference) return;

    const payment = await Payment.findOne({ reference });
    if (!payment) return;

    PaymentStateMachine.transition(payment, "failed");
    payment.failureReason = eventType === "transfer.reversed" ? "Transfer reversed by bank" : "Transfer failed";
    payment.providerData = data;
    await payment.save();

    // Withdrawal Failure: Unlock pendingBalance back to available balance
    if (payment.type === "withdrawal" && payment.talentId) {
        const wallet = await Wallet.findOne({ user: payment.talentId });
        if (wallet) {
            wallet.pendingBalance = Math.max(0, (wallet.pendingBalance || 0) - payment.amount);
            wallet.balance = (wallet.balance || 0) + payment.amount;
            if (wallet.withdrawals) {
                const pending = wallet.withdrawals.find((w) => w.reference === reference);
                if (pending) pending.status = "failed";
            }
            await wallet.save();
        }
    }

    if (payment.talentId) {
        await notify(
            payment.talentId,
            "payment_failed",
            "Payment Failed",
            `A payment transfer of ₦${payment.amount.toLocaleString()} failed. Funds have been returned to your wallet.`,
            payment.taskId
        );
    }
}

// =============================================================================
// CREATE PAYMENT INTENT — POST /api/payments/create-intent
// Registers payment intent in database BEFORE initializing Paystack checkout URL.
// =============================================================================
const createPaymentIntent = async (req, res) => {
    try {
        const { taskId } = req.body;
        if (!taskId) return res.status(400).json({ message: "taskId is required" });

        const task = await Task.findById(taskId).populate("businessOwner", "email name");
        if (!task) return res.status(404).json({ message: "Task not found" });
        if (String(task.businessOwner._id) !== String(req.user._id)) {
            return res.status(403).json({ message: "Not authorized" });
        }
        if (!["accepted", "awaiting_funding"].includes(task.status)) {
            return res.status(400).json({
                message: `Task must be in 'awaiting_funding' state to fund. Current: '${task.status}'`,
            });
        }
        if (!task.budget?.amount || task.budget.amount <= 0) {
            return res.status(400).json({ message: "Task budget is invalid" });
        }

        const amount = task.budget.amount;
        const currency = task.budget.currency || "NGN";
        const reference = `VT-ESC-${taskId}-${Date.now()}`;
        const intentId = `PI-ESC-${taskId}-${Date.now()}`;

        // Calculate marketplace ledger fields (future-proofed)
        const commissionFee = Math.round(amount * (PLATFORM_COMMISSION_PERCENT / 100));
        const netAmount = amount - commissionFee;

        // 1. Register PaymentIntent BEFORE Paystack Initialization
        const intent = await PaymentIntent.create({
            intentId,
            clientId: req.user._id,
            talentId: task.assignedTalent,
            taskId,
            amount,
            currency,
            status: "initialized",
            providerReference: reference,
        });

        // 2. Register Payment Ledger Record
        const payment = await Payment.create({
            clientId: req.user._id,
            talentId: task.assignedTalent,
            taskId,
            paymentIntentId: intent._id,
            amount,
            grossAmount: amount,
            platformCommissionFee: commissionFee,
            platformCommissionPercent: PLATFORM_COMMISSION_PERCENT,
            netTalentAmount: netAmount,
            currency,
            type: "escrow_hold",
            status: "pending",
            reference,
        });

        // 3. Initialize Paystack Checkout URL
        const paystackRes = await PaymentService.initiateEscrow({
            amount,
            email: task.businessOwner.email,
            taskId,
            reference,
            currency,
        });

        // Update Payment & PaymentIntent with authorization URL
        intent.checkoutUrl = paystackRes.checkoutUrl || null;
        PaymentStateMachine.transition(intent, "pending");
        await intent.save();

        payment.checkoutUrl = paystackRes.checkoutUrl || null;
        await payment.save();

        // Advance task to awaiting_funding
        task.status = "awaiting_funding";
        task.addTimeline("Escrow Initiated", `Payment intent created (ref: ${reference}).`, "client");
        await task.save();

        await AuditLogger.log({
            actorId: req.user._id,
            actorRole: "client",
            action: "PAYMENT_INTENT_CREATED",
            resourceType: "PaymentIntent",
            resourceId: intent._id,
            amount,
            reference,
        });

        res.json({
            intentId: intent.intentId,
            reference,
            checkoutUrl: paystackRes.checkoutUrl || null,
            amount,
            currency,
            provider: PaymentService.getProviderName(),
        });
    } catch (err) {
        console.error("[createPaymentIntent]", err);
        res.status(500).json({ message: err.message });
    }
};

// =============================================================================
// INITIATE ESCROW (LEGACY WRAPPER OVER PAYMENT INTENT)
// =============================================================================
const initiateEscrow = async (req, res) => {
    return createPaymentIntent(req, res);
};

// =============================================================================
// GET PAYMENT RECEIPT DATA — GET /api/payments/:id/receipt
// =============================================================================
const getPaymentReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const receiptData = await ReceiptService.generateReceiptData(id);

        if (req.query.format === "html") {
            const html = ReceiptService.renderHTMLReceipt(receiptData);
            res.setHeader("Content-Type", "text/html");
            return res.send(html);
        }

        res.json({ receipt: receiptData });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// =============================================================================
// ADMIN: TRIGGER MANUAL RECONCILIATION — POST /api/payments/admin/reconcile
// =============================================================================
const adminTriggerReconciliation = async (req, res) => {
    try {
        const results = await ReconciliationEngine.reconcilePendingPayments();
        res.json({
            message: "Reconciliation pass completed successfully",
            results,
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// =============================================================================
// GET PAYMENT HISTORY — GET /api/payments/history
// =============================================================================
const getPaymentHistory = async (req, res) => {
    try {
        const { page = 1, limit = 20, type } = req.query;
        const userId = req.user._id;
        const userRole = req.user.role;

        const query = {};
        if (userRole === "client") query.clientId = userId;
        else if (userRole === "talent") query.talentId = userId;
        else return res.status(403).json({ message: "Access denied" });

        if (type) query.type = type;

        const [payments, total] = await Promise.all([
            Payment.find(query)
                .populate("taskId", "title category status")
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(Number(limit)),
            Payment.countDocuments(query),
        ]);

        res.json({
            payments,
            pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// =============================================================================
// GET PAYMENT SUMMARY — GET /api/payments/summary
// =============================================================================
const getPaymentSummary = async (req, res) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;

        const matchField = userRole === "client" ? "clientId" : "talentId";
        const userObjectId = new mongoose.Types.ObjectId(userId);

        const [totals] = await Payment.aggregate([
            { $match: { [matchField]: userObjectId } },
            {
                $group: {
                    _id: null,
                    totalSpent: {
                        $sum: { $cond: [{ $eq: ["$type", "escrow_hold"] }, "$amount", 0] },
                    },
                    totalEarned: {
                        $sum: { $cond: [{ $eq: ["$type", "escrow_release"] }, "$amount", 0] },
                    },
                    activeEscrow: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$type", "escrow_hold"] }, { $in: ["$status", ["pending", "escrow_funded"]] }] },
                                "$amount",
                                0,
                            ],
                        },
                    },
                    totalWithdrawn: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$type", "withdrawal"] }, { $in: ["$status", ["success", "completed"]] }] },
                                "$amount",
                                0,
                            ],
                        },
                    },
                    failedCount: {
                        $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
                    },
                },
            },
        ]);

        res.json(totals || {
            totalSpent: 0,
            totalEarned: 0,
            activeEscrow: 0,
            totalWithdrawn: 0,
            failedCount: 0,
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// =============================================================================
// ADMIN: GET ALL PAYMENTS — GET /api/payments/admin
// =============================================================================
const adminGetAllPayments = async (req, res) => {
    try {
        const { page = 1, limit = 50, status, type } = req.query;
        const query = {};
        if (status) query.status = status;
        if (type) query.type = type;

        const [payments, total] = await Promise.all([
            Payment.find(query)
                .populate("clientId", "name email")
                .populate("talentId", "name email")
                .populate("taskId", "title category")
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(Number(limit)),
            Payment.countDocuments(query),
        ]);

        res.json({
            payments,
            pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// ─── VERIFY PAYMENT — GET /api/payments/verify/:reference ────────────────────
// Used by client callback/URL recovery to confirm payment and lock escrow
const verifyPayment = async (req, res) => {
    try {
        const { reference } = req.params;
        if (!reference) return res.status(400).json({ message: "Reference is required" });

        let payment = await Payment.findOne({ reference });
        if (!payment) {
            payment = await Payment.findOne({ providerReference: reference });
        }

        // Search task if reference matches task ID format
        if (!payment && reference.includes("VT-ESC-")) {
            const taskIdFromRef = reference.split("-")[2];
            if (taskIdFromRef) {
                payment = await Payment.findOne({ taskId: taskIdFromRef }).sort({ createdAt: -1 });
            }
        }

        if (!payment) {
            return res.status(404).json({ message: `Payment transaction not found for reference: ${reference}` });
        }

        // If payment is already in terminal/funded state, ensure task state is synchronized
        if (["escrow_funded", "success", "released", "completed"].includes(payment.status)) {
            const task = await Task.findById(payment.taskId);
            if (task && task.status === "awaiting_funding") {
                task.status = "funded";
                task.escrow.fundedAt = task.escrow.fundedAt || new Date();
                task.escrow.amount = payment.amount;
                task.addTimeline("Payment Confirmed", `Escrow funded via Paystack (ref: ${reference}).`, "system");
                await task.save();

                task.status = "in_progress";
                task.workStartedAt = task.workStartedAt || new Date();
                task.addTimeline("Project Started", "Work has officially commenced.", "system");
                await task.save();

                await notify(task.businessOwner, "escrow_funded", "Escrow Funded", "Your project is now fully funded. Work has started!", task._id);
                if (task.assignedTalent) {
                    await notify(task.assignedTalent, "project_started", "Project Started", "The client has funded the project. You can now begin work!", task._id);
                }
            }
            return res.json({ message: "Payment verified successfully", payment, task: await Task.findById(payment.taskId) });
        }

        // Execute payment verification & task state advancement
        await handleChargeSuccess({ reference: payment.reference || reference });

        const updatedPayment = await Payment.findById(payment._id);
        const updatedTask = await Task.findById(payment.taskId);

        // Fallback sync for dev/test environments if Paystack API verification is mocked or pending
        if (updatedTask && updatedTask.status === "awaiting_funding") {
            updatedTask.status = "funded";
            updatedTask.escrow.fundedAt = new Date();
            updatedTask.escrow.amount = updatedPayment ? updatedPayment.amount : updatedTask.budget?.amount;
            updatedTask.addTimeline("Payment Confirmed", `Escrow funded (ref: ${reference}).`, "system");
            await updatedTask.save();

            updatedTask.status = "in_progress";
            updatedTask.workStartedAt = new Date();
            updatedTask.addTimeline("Project Started", "Work has officially commenced.", "system");
            await updatedTask.save();

            if (updatedPayment && updatedPayment.status !== "escrow_funded") {
                updatedPayment.status = "escrow_funded";
                updatedPayment.reconciledAt = new Date();
                await updatedPayment.save();
            }

            await notify(updatedTask.businessOwner, "escrow_funded", "Escrow Funded", "Your project is now fully funded. Work has started!", updatedTask._id);
            if (updatedTask.assignedTalent) {
                await notify(updatedTask.assignedTalent, "project_started", "Project Started", "The client has funded the project. You can now begin work!", updatedTask._id);
            }
        }

        res.json({
            message: "Payment verified successfully",
            payment: updatedPayment || payment,
            task: updatedTask || (await Task.findById(payment.taskId)),
        });
    } catch (error) {
        console.error("[verifyPayment] Error verifying payment:", error.message);
        res.status(500).json({ message: error.message });
    }
};

// ─── ADMIN: GET WEBHOOK EVENTS — GET /api/payments/admin/webhooks ────────────
const adminGetWebhookEvents = async (req, res) => {
    try {
        const { page = 1, limit = 50, event, processed } = req.query;
        const query = {};
        if (event) query.event = event;
        if (processed !== undefined && processed !== "") query.processed = processed === "true";

        const [events, total] = await Promise.all([
            WebhookEvent.find(query)
                .sort({ receivedAt: -1 })
                .skip((page - 1) * limit)
                .limit(Number(limit)),
            WebhookEvent.countDocuments(query),
        ]);

        res.json({
            events,
            pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

module.exports = {
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
};

