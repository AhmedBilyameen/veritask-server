const mongoose = require("mongoose");

/**
 * IdempotencyKey Schema
 * Atomic lock key store for financial operations and webhooks.
 * Uses a unique compound index on { key: 1, eventType: 1 } to guarantee
 * that concurrent requests fail cleanly with a duplicate key error (E11000).
 */
const idempotencyKeySchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
        },
        eventType: {
            type: String,
            required: true,
        },
        status: {
            type: String,
            enum: ["processing", "completed", "failed"],
            default: "processing",
        },
        response: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
        lockedAt: {
            type: Date,
            default: Date.now,
            expires: 86400, // Auto-clean keys after 24 hours
        },
    },
    { timestamps: true }
);

idempotencyKeySchema.index({ key: 1, eventType: 1 }, { unique: true });

module.exports = mongoose.model("IdempotencyKey", idempotencyKeySchema);
