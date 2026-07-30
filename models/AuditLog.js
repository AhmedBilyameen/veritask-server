const mongoose = require("mongoose");

/**
 * AuditLog Schema
 * Immutable record of every financial mutation across the platform.
 * Logs actor, action type, resource IDs, financial delta, previous state, new state,
 * IP address, and raw provider response for forensic auditing.
 */
const auditLogSchema = new mongoose.Schema(
    {
        actorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },
        actorRole: {
            type: String,
            enum: ["client", "talent", "admin", "system"],
            default: "system",
        },
        action: {
            type: String,
            required: true,
            enum: [
                "PAYMENT_INTENT_CREATED",
                "ESCROW_HOLD_INITIATED",
                "ESCROW_FUNDED",
                "ESCROW_RELEASED",
                "WALLET_CREDITED",
                "WITHDRAWAL_REQUESTED",
                "WITHDRAWAL_LOCKED",
                "WITHDRAWAL_COMPLETED",
                "WITHDRAWAL_FAILED",
                "WITHDRAWAL_REVERSED",
                "ADMIN_BALANCE_ADJUSTED",
                "RECONCILIATION_PERFORMED",
                "PAYMENT_FAILED",
                "REFUND_ISSUED",
            ],
            index: true,
        },
        resourceType: {
            type: String,
            enum: ["Payment", "PaymentIntent", "Wallet", "Task", "WebhookEvent"],
            required: true,
        },
        resourceId: {
            type: String,
            required: true,
            index: true,
        },
        amount: {
            type: Number,
            default: 0,
        },
        reference: {
            type: String,
            default: null,
            index: true,
        },
        previousState: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
        newState: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
        ipAddress: {
            type: String,
            default: null,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    { timestamps: true }
);

auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
