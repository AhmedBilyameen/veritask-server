/**
 * Mock Payment Adapter — simulates payment flows for v1.
 * Replace with a real provider (e.g. Paystack) by implementing
 * the same interface in a new adapter file.
 */

const mockAdapter = {
    async initiateEscrow({ amount, currency = "NGN", taskId, clientId }) {
        // In production: call Paystack charge API, create authorization
        return {
            reference: `MOCK-ESC-${taskId}-${Date.now()}`,
            status: "success",
            amount,
            currency,
        };
    },

    async releaseEscrow({ amount, currency = "NGN", taskId, talentId, reference }) {
        // In production: call Paystack transfer API to talent sub-account
        return {
            success: true,
            transactionId: `MOCK-REL-${taskId}-${Date.now()}`,
            amount,
            currency,
        };
    },

    async initiateWithdrawal({ amount, currency = "NGN", bankDetails, walletId }) {
        // In production: call Paystack transfer to bank account
        return {
            reference: `MOCK-WD-${walletId}-${Date.now()}`,
            status: "pending",
            amount,
            currency,
        };
    },

    async verifyWebhook(payload) {
        // In production: verify HMAC signature from Paystack webhook
        return {
            valid: true,
            reference: payload.reference || "MOCK",
            amount: payload.amount || 0,
            status: payload.status || "success",
        };
    },
};

module.exports = mockAdapter;
