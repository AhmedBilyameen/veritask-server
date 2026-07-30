const mongoose = require("mongoose");

// ─── Payment Model ─────────────────────────────────────────────────────────────
// Acts as the central audit ledger for all financial transactions in the system.
// Every escrow hold, release, platform fee, and withdrawal is recorded here
// so that admins can reconcile the books without querying individual wallets.

const paymentSchema = new mongoose.Schema(
    {
        // ── Parties ────────────────────────────────────────────────────────────────
        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        talentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        taskId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Task",
            default: null,
        },

        // ── Amount ────────────────────────────────────────────────────────────────
        amount: {
            type: Number,
            required: true,
            min: 0,
        },
        currency: {
            type: String,
            default: "NGN",
        },

        // ── Type ──────────────────────────────────────────────────────────────────
        type: {
            type: String,
            enum: [
                "escrow_hold",        // Client locks funds for a project
                "escrow_release",     // Funds released to talent after approval
                "withdrawal",         // Talent withdraws from wallet to bank
                "platform_commission",// Platform fee deducted during escrow release
                "refund",             // Future: Client receives refund on cancellation
            ],
            required: true,
        },

        // ── Status ────────────────────────────────────────────────────────────────
        status: {
            type: String,
            enum: [
                "initialized",
                "pending",
                "authorized",
                "verified",
                "escrow_funded",
                "released",
                "completed",
                "failed",
                "expired",
                "cancelled",
                "refund_requested",
                "refund_processing",
                "refunded",
                "success", // legacy backward compatibility
            ],
            default: "pending",
        },

        // ── Payment Intent Reference ──────────────────────────────────────────────
        paymentIntentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "PaymentIntent",
            default: null,
            index: true,
        },

        // ── Paystack References ───────────────────────────────────────────────────
        reference: {
            type: String,
            unique: true,
            sparse: true,
        },
        checkoutUrl: {
            type: String,
            default: null,
        },

        // ── Marketplace Financial Ledger Breakdown ────────────────────────────────
        // Future-proofed to support platform commissions, taxes, discounts, and milestones
        grossAmount: {
            type: Number,
            default: function () {
                return this.amount || 0;
            },
        },
        platformCommissionFee: {
            type: Number,
            default: 0,
        },
        platformCommissionPercent: {
            type: Number,
            default: 0,
        },
        netTalentAmount: {
            type: Number,
            default: function () {
                return (this.amount || 0) - (this.platformCommissionFee || 0);
            },
        },
        taxAmount: {
            type: Number,
            default: 0,
        },
        discountAmount: {
            type: Number,
            default: 0,
        },
        milestoneId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
        isPartialRelease: {
            type: Boolean,
            default: false,
        },

        // ── Legacy Compatibility ──────────────────────────────────────────────────
        platformFee: {
            type: Number,
            default: 0,
        },
        platformFeePercent: {
            type: Number,
            default: 0,
        },

        // ── Raw Provider Data ─────────────────────────────────────────────────────
        providerData: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },

        // ── Reconciliation ────────────────────────────────────────────────────────
        reconciledAt: {
            type: Date,
            default: null,
        },

        // ── Failure Info ──────────────────────────────────────────────────────────
        failureReason: {
            type: String,
            default: null,
        },
    },
    { timestamps: true }
);

// Index for fast task/client lookups
paymentSchema.index({ taskId: 1, type: 1 });
paymentSchema.index({ clientId: 1, createdAt: -1 });
paymentSchema.index({ talentId: 1, createdAt: -1 });

module.exports = mongoose.model("Payment", paymentSchema);
