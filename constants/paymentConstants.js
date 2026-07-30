/**
 * Centralized Financial Constants — VeriTask Payment Infrastructure
 * Avoids magic numbers across controllers, services, and webhooks.
 */

module.exports = {
    PAYMENT_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes for checkout expiration
    WITHDRAWAL_MINIMUM_NGN: 1000,       // Minimum withdrawal ₦1,000
    WITHDRAWAL_MAXIMUM_NGN: 5000000,    // Maximum withdrawal ₦5,000,000 per request
    RECONCILIATION_INTERVAL_MINUTES: 10, // Frequency of automated reconciliation background checks
    SUPPORTED_CURRENCIES: ["NGN", "USD"],
    DEFAULT_CURRENCY: "NGN",
    PAYSTACK_RETRY_LIMIT: 3,
    WEBHOOK_MAX_AGE_MS: 5 * 60 * 1000,   // 5 minutes max skew for webhook processing

    // Marketplace Commission Structure (Default: 0% zero-commission marketplace)
    // Future expansion: change PLATFORM_COMMISSION_PERCENT to 10 for a 10% platform fee
    PLATFORM_COMMISSION_PERCENT: 0,
    VAT_PERCENT: 0,
};
