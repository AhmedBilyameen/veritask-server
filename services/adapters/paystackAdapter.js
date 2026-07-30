/**
 * Paystack Adapter — Production-ready adapter for the Paystack payment gateway.
 *
 * Implements the same interface as mockPaymentAdapter so swapping between
 * providers only requires changing PAYMENT_PROVIDER in .env.
 *
 * Required environment variables:
 *   PAYSTACK_SECRET_KEY  — Your Paystack secret key (sk_live_... or sk_test_...)
 *   PAYSTACK_CALLBACK_URL — The URL Paystack redirects to after payment
 */

const https = require("https");
const crypto = require("crypto");

const PAYSTACK_BASE = "payapi.io";  // not used directly; calls via fetch/https
const PAYSTACK_API = "https://api.paystack.co";
const SECRET = process.env.PAYSTACK_SECRET_KEY;

// ─── Internal HTTP helper (uses https module — reliable across all Node.js versions) ─
function paystackRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        if (!SECRET) {
            return reject(new Error("PAYSTACK_SECRET_KEY is not defined in environment variables."));
        }

        const postData = body ? JSON.stringify(body) : null;
        const options = {
            hostname: "api.paystack.co",
            port: 443,
            path,
            method,
            headers: {
                Authorization: `Bearer ${SECRET}`,
                "Content-Type": "application/json",
                Accept: "application/json",
                ...(postData ? { "Content-Length": Buffer.byteLength(postData) } : {}),
            },
            timeout: 10000,
        };

        const req = https.request(options, (res) => {
            let raw = "";
            res.on("data", (chunk) => { raw += chunk; });
            res.on("end", () => {
                try {
                    const data = JSON.parse(raw);
                    if (res.statusCode >= 400) {
                        return reject(new Error(data.message || `Paystack error: ${res.statusCode}`));
                    }
                    resolve(data);
                } catch (parseErr) {
                    reject(new Error(`Failed to parse Paystack response: ${raw.slice(0, 120)}`));
                }
            });
        });

        req.on("error", (err) => reject(err));
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Paystack API request timed out after 10 seconds"));
        });

        if (postData) req.write(postData);
        req.end();
    });
}

// ─── Adapter Implementation ───────────────────────────────────────────────────
const paystackAdapter = {
    /**
     * Initiate an escrow hold by generating a Paystack payment link.
     * The client is redirected to this checkout URL to complete payment.
     *
     * @param {object} opts - { amount (in kobo), email, taskId, reference }
     * @returns { reference, checkoutUrl, status }
     */
    async initiateEscrow({ amount, email, taskId, reference, currency = "NGN" }) {
        // Paystack expects amount in kobo (multiply NGN by 100)
        const amountInKobo = Math.round(amount * 100);

        const payload = {
            email,
            amount: amountInKobo,
            currency,
            reference,
            callback_url: process.env.PAYSTACK_CALLBACK_URL || "http://localhost:3000/payment/callback",
            metadata: {
                task_id: taskId,
                payment_type: "escrow_hold",
                custom_fields: [
                    { display_name: "Task ID", variable_name: "task_id", value: taskId },
                ],
            },
        };

        const res = await paystackRequest("POST", "/transaction/initialize", payload);

        return {
            reference: res.data.reference,
            checkoutUrl: res.data.authorization_url,
            status: "pending",
        };
    },

    /**
     * Verify a Paystack transaction by reference.
     * Used to confirm escrow payment before advancing task status.
     *
     * @param {string} reference - Paystack transaction reference
     * @returns { success, amount (in NGN), status, providerData }
     */
    async verifyPayment(reference) {
        try {
            const res = await paystackRequest("GET", `/transaction/verify/${reference}`);
            const data = res.data;

            return {
                success: data.status === "success",
                amount: data.amount / 100, // Convert from kobo to NGN
                status: data.status,
                currency: data.currency,
                providerData: data,
            };
        } catch (err) {
            console.warn(`[PaystackAdapter] verifyPayment failed for ref '${reference}':`, err.message);
            return {
                success: false,
                amount: 0,
                status: "failed",
                error: err.message,
                providerData: null,
            };
        }
    },

    /**
     * Release escrow funds to a talent's bank account via Paystack Transfers.
     * This is a two-step process: create a recipient, then initiate a transfer.
     *
     * @param {object} opts - { amount, bankCode, accountNumber, recipientName, taskId, currency }
     * @returns { success, transactionId, reference }
     */
    async releaseEscrow({ amount, bankCode, accountNumber, recipientName, taskId, currency = "NGN" }) {
        // Step 1: Create or retrieve a transfer recipient
        const recipientPayload = {
            type: "nuban",
            name: recipientName,
            account_number: accountNumber,
            bank_code: bankCode,
            currency,
        };

        const recipientRes = await paystackRequest("POST", "/transferrecipient", recipientPayload);
        const recipientCode = recipientRes.data.recipient_code;

        // Step 2: Initiate the transfer
        const amountInKobo = Math.round(amount * 100);
        const transferPayload = {
            source: "balance",
            amount: amountInKobo,
            recipient: recipientCode,
            reason: `VeriTask escrow release for task ${taskId}`,
        };

        const transferRes = await paystackRequest("POST", "/transfer", transferPayload);

        return {
            success: true,
            transactionId: transferRes.data.id,
            reference: transferRes.data.reference,
            providerData: transferRes.data,
        };
    },

    /**
     * Initiate a withdrawal from the talent wallet to their bank account.
     * Same mechanism as releaseEscrow — Paystack Transfer API.
     *
     * @param {object} opts - { amount, bankCode, accountNumber, recipientName, walletId, currency }
     * @returns { reference, status }
     */
    async initiateWithdrawal({ amount, bankCode, accountNumber, recipientName, walletId, currency = "NGN" }) {
        const recipientPayload = {
            type: "nuban",
            name: recipientName,
            account_number: accountNumber,
            bank_code: bankCode,
            currency,
        };

        const recipientRes = await paystackRequest("POST", "/transferrecipient", recipientPayload);
        const recipientCode = recipientRes.data.recipient_code;

        const amountInKobo = Math.round(amount * 100);
        const transferPayload = {
            source: "balance",
            amount: amountInKobo,
            recipient: recipientCode,
            reason: `VeriTask wallet withdrawal for wallet ${walletId}`,
        };

        const transferRes = await paystackRequest("POST", "/transfer", transferPayload);

        return {
            reference: transferRes.data.reference,
            status: "pending",
            providerData: transferRes.data,
        };
    },

    /**
     * Verify a Paystack webhook signature.
     * Ensures the webhook came from Paystack and not a malicious third party.
     *
     * @param {string} signature - The x-paystack-signature header from the request
     * @param {string|Buffer} rawBody - The raw request body (must be pre-buffer before JSON.parse)
     * @returns {boolean}
     */
    verifyWebhookSignature(signature, rawBody) {
        if (!SECRET) return false;
        const hash = crypto
            .createHmac("sha512", SECRET)
            .update(rawBody)
            .digest("hex");
        return hash === signature;
    },

    /**
     * Legacy verifyWebhook method kept for PaymentService interface compatibility.
     * In production, use verifyWebhookSignature + the event data from the webhook body.
     */
    async verifyWebhook(payload) {
        return {
            valid: true,
            reference: payload.data?.reference || "UNKNOWN",
            amount: (payload.data?.amount || 0) / 100,
            status: payload.data?.status || "unknown",
        };
    },
};

module.exports = paystackAdapter;
