const mongoose = require("mongoose");

/**
 * WebhookEvent Schema
 * Immutable audit log of every incoming webhook received from Paystack
 * or external payment providers, including duplicate deliveries, signature
 * verification attempts, processing duration, and error traces.
 */
const webhookEventSchema = new mongoose.Schema(
    {
        provider: {
            type: String,
            required: true,
            default: "paystack",
            index: true,
        },
        event: {
            type: String,
            required: true,
            index: true,
        },
        signature: {
            type: String,
            default: null,
        },
        payload: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        processed: {
            type: Boolean,
            default: false,
            index: true,
        },
        processingTimeMs: {
            type: Number,
            default: 0,
        },
        receivedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        ip: {
            type: String,
            default: null,
        },
        headers: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        error: {
            type: String,
            default: null,
        },
    },
    { timestamps: true }
);

webhookEventSchema.index({ provider: 1, event: 1, receivedAt: -1 });

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);
