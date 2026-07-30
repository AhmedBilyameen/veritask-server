/**
 * PaymentService — abstraction layer over any payment provider.
 *
 * All business logic interacts with this service, never with a specific
 * provider SDK directly. Swapping providers (Paystack → Stripe → Flutterwave)
 * only requires adding a new adapter and changing PAYMENT_PROVIDER in .env.
 *
 * Provider selection:
 *   - If PAYSTACK_SECRET_KEY is set → uses paystackAdapter (production)
 *   - Otherwise falls back to mockAdapter (development / CI)
 *   - Override explicitly with PAYMENT_PROVIDER=mock|paystack
 */

const PROVIDERS = {
    mock: require("./adapters/mockPaymentAdapter"),
    paystack: require("./adapters/paystackAdapter"),
    // stripe  : require("./adapters/stripeAdapter"),
    // flutterwave: require("./adapters/flutterwaveAdapter"),
};

// Auto-select Paystack if the key is available, unless explicitly overridden
const ACTIVE_PROVIDER =
    process.env.PAYMENT_PROVIDER ||
    (process.env.PAYSTACK_SECRET_KEY ? "paystack" : "mock");

function getAdapter() {
    const adapter = PROVIDERS[ACTIVE_PROVIDER];
    if (!adapter) throw new Error(`Unknown payment provider: ${ACTIVE_PROVIDER}`);
    return adapter;
}

const PaymentService = {
    /**
     * Initiate an escrow hold for a project.
     * Paystack: returns a checkoutUrl the client visits to complete payment.
     * @param {object} opts - { amount, email, taskId, reference, currency? }
     * @returns {Promise<{ reference, checkoutUrl?, status }>}
     */
    initiateEscrow: (opts) => getAdapter().initiateEscrow(opts),

    /**
     * Verify a payment by reference (called after Paystack callback/webhook).
     * @param {string} reference - Transaction reference string
     * @returns {Promise<{ success, amount, status, providerData }>}
     */
    verifyPayment: (reference) => {
        const adapter = getAdapter();
        if (typeof adapter.verifyPayment === "function") {
            return adapter.verifyPayment(reference);
        }
        // Mock fallback
        return Promise.resolve({ success: true, amount: 0, status: "success", providerData: {} });
    },

    /**
     * Release escrow funds to the talent's bank account.
     * @param {object} opts - { amount, bankCode, accountNumber, recipientName, taskId, currency? }
     * @returns {Promise<{ success, transactionId, reference }>}
     */
    releaseEscrow: (opts) => getAdapter().releaseEscrow(opts),

    /**
     * Initiate a withdrawal from the talent wallet to their bank account.
     * @param {object} opts - { amount, bankCode, accountNumber, recipientName, walletId, currency? }
     * @returns {Promise<{ reference, status }>}
     */
    initiateWithdrawal: (opts) => getAdapter().initiateWithdrawal(opts),

    /**
     * Verify a Paystack webhook HMAC signature.
     * @param {string} signature - x-paystack-signature header
     * @param {string|Buffer} rawBody - Raw request body before JSON parsing
     * @returns {boolean}
     */
    verifyWebhookSignature: (signature, rawBody) => {
        const adapter = getAdapter();
        if (typeof adapter.verifyWebhookSignature === "function") {
            return adapter.verifyWebhookSignature(signature, rawBody);
        }
        return true; // mock always passes
    },

    /** @deprecated Use verifyPayment() + verifyWebhookSignature() instead */
    verifyWebhook: (payload) => getAdapter().verifyWebhook(payload),

    /** Returns the currently active provider name (useful for logging) */
    getProviderName: () => ACTIVE_PROVIDER,
};

module.exports = PaymentService;
