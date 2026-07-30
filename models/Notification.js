const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        recipient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        type: {
            type: String,
            required: true,
            enum: [
                "offer_received",
                "offer_accepted",
                "offer_declined",
                "offer_resent",
                "offer_cancelled",
                "offer_expired",
                "funding_required",
                "project_funded",
                "work_submitted",
                "revision_requested",
                "project_approved",
                "payment_released",
                "review_requested",
                // ── Newly added: used by paymentController, walletController ──
                "escrow_funded",
                "project_started",
                "payment_received",
                "withdrawal_completed",
                "payment_failed",
                "review_submitted",
                "withdrawal_status_updated",
                "general",
            ],
            default: "general",
        },
        title: {
            type: String,
            required: true,
        },
        message: {
            type: String,
            required: true,
        },
        taskId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Task",
            default: null,
        },
        isRead: {
            type: Boolean,
            default: false,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    { timestamps: true }
);

// Index for fast per-user queries
notificationSchema.index({ recipient: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
