const mongoose = require("mongoose");
const { DEFAULT_CURRENCY, PAYMENT_TIMEOUT_MS } = require("../constants/paymentConstants");

/**
 * PaymentIntent Schema
 * Pre-registers every financial transaction intent in the database BEFORE
 * communicating with Paystack or external payment gateways.
 */
const paymentIntentSchema = new mongoose.Schema(
    {
        intentId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        talentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        taskId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Task",
            required: true,
            index: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 0,
        },
        currency: {
            type: String,
            default: DEFAULT_CURRENCY,
        },
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
            ],
            default: "initialized",
            index: true,
        },
        providerReference: {
            type: String,
            default: null,
            index: true,
        },
        checkoutUrl: {
            type: String,
            default: null,
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + PAYMENT_TIMEOUT_MS),
            index: true,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("PaymentIntent", paymentIntentSchema);
