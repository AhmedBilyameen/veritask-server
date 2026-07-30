const Payment = require("../models/Payment");
const PaymentIntent = require("../models/PaymentIntent");
const Task = require("../models/Task");
const User = require("../models/User");

/**
 * ReceiptService — Production Receipt Generation Engine
 * Generates immutable receipt numbers, financial line items (Gross, Fee, Net, Tax),
 * party metadata, and HTML/PDF renderable structures.
 */

const ReceiptService = {
    /**
     * Generate structured receipt payload for a payment or withdrawal ID.
     * @param {string} paymentId
     * @returns {Promise<object>}
     */
    async generateReceiptData(paymentId) {
        const payment = await Payment.findById(paymentId)
            .populate("clientId", "name email profile")
            .populate("talentId", "name email profile")
            .populate("taskId", "title category budget");

        if (!payment) {
            throw new Error(`Payment record not found: ${paymentId}`);
        }

        const formattedDate = new Date(payment.createdAt).toLocaleDateString("en-NG", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

        // Receipt Numbering: REC-{YYYYMMDD}-{ShortID}
        const dateStr = new Date(payment.createdAt).toISOString().slice(0, 10).replace(/-/g, "");
        const shortId = payment._id.toString().slice(-6).toUpperCase();
        const receiptNo = `REC-${dateStr}-${shortId}`;

        const gross = payment.grossAmount || payment.amount || 0;
        const commission = payment.platformCommissionFee || payment.platformFee || 0;
        const net = payment.netTalentAmount || (gross - commission);
        const tax = payment.taxAmount || 0;

        return {
            receiptNo,
            paymentReference: payment.reference || "N/A",
            date: formattedDate,
            rawTimestamp: payment.createdAt,
            type: payment.type,
            status: payment.status,
            currency: payment.currency || "NGN",
            financials: {
                grossAmount: gross,
                platformCommissionFee: commission,
                platformCommissionPercent: payment.platformCommissionPercent || 0,
                netTalentAmount: net,
                taxAmount: tax,
            },
            client: payment.clientId ? {
                id: payment.clientId._id,
                name: payment.clientId.name,
                email: payment.clientId.email,
            } : null,
            talent: payment.talentId ? {
                id: payment.talentId._id,
                name: payment.talentId.name,
                email: payment.talentId.email,
            } : null,
            project: payment.taskId ? {
                id: payment.taskId._id,
                title: payment.taskId.title,
                category: payment.taskId.category,
            } : null,
            providerData: {
                paymentMethod: payment.providerData?.channel || "Paystack / Card / Bank",
                gatewayReference: payment.providerData?.reference || payment.reference,
            },
        };
    },

    /**
     * Render printable HTML string for receipt download/view.
     * @param {object} receipt
     * @returns {string} HTML string
     */
    renderHTMLReceipt(receipt) {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8" />
    <title>Receipt ${receipt.receiptNo}</title>
    <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 40px; background: #fafafa; color: #111; }
        .receipt-card { max-width: 650px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 36px; border: 1px solid #eaeaea; box-shadow: 0 4px 20px rgba(0,0,0,0.04); }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f0f0f0; padding-bottom: 20px; margin-bottom: 24px; }
        .brand { font-size: 24px; font-weight: 800; color: #000; letter-spacing: -0.5px; }
        .brand span { color: #2563eb; }
        .receipt-num { text-align: right; font-size: 14px; color: #666; }
        .receipt-num strong { display: block; font-size: 16px; color: #111; margin-top: 4px; }
        .section { margin-bottom: 24px; }
        .section-title { font-size: 12px; text-transform: uppercase; color: #888; letter-spacing: 1px; margin-bottom: 8px; font-weight: 700; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .line-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        .line-table th, .line-table td { padding: 12px 0; border-bottom: 1px solid #f0f0f0; text-align: left; }
        .line-table th { color: #888; font-size: 12px; text-transform: uppercase; font-weight: 600; }
        .total-row td { font-size: 18px; font-weight: 800; border-bottom: none; border-top: 2px solid #111; padding-top: 16px; }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 99px; font-size: 12px; font-weight: 700; background: #dcfce7; color: #166534; text-transform: uppercase; }
        .footer { margin-top: 36px; padding-top: 20px; border-top: 1px solid #f0f0f0; text-align: center; font-size: 12px; color: #888; }
    </style>
</head>
<body>
    <div class="receipt-card">
        <div class="header">
            <div class="brand">Veri<span>Task</span></div>
            <div class="receipt-num">
                OFFICIAL PAYMENT RECEIPT
                <strong>${receipt.receiptNo}</strong>
            </div>
        </div>

        <div class="section grid">
            <div>
                <div class="section-title">Paid By (Client)</div>
                <div><strong>${receipt.client?.name || "N/A"}</strong></div>
                <div style="font-size: 13px; color: #666;">${receipt.client?.email || ""}</div>
            </div>
            <div>
                <div class="section-title">Payment Details</div>
                <div style="font-size: 13px;">Date: ${receipt.date}</div>
                <div style="font-size: 13px;">Ref: ${receipt.paymentReference}</div>
                <div style="margin-top: 6px;"><span class="status-badge">${receipt.status}</span></div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Project Context</div>
            <div style="font-size: 15px; font-weight: 600;">${receipt.project?.title || "VeriTask Platform Service"}</div>
            <div style="font-size: 13px; color: #666;">Category: ${receipt.project?.category || "Escrow Service"}</div>
        </div>

        <table class="line-table">
            <thead>
                <tr>
                    <th>Description</th>
                    <th style="text-align: right;">Amount (${receipt.currency})</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>Gross Escrow Amount</td>
                    <td style="text-align: right;">₦${receipt.financials.grossAmount.toLocaleString()}</td>
                </tr>
                <tr>
                    <td>Platform Service Fee (${receipt.financials.platformCommissionPercent}%)</td>
                    <td style="text-align: right;">₦${receipt.financials.platformCommissionFee.toLocaleString()}</td>
                </tr>
                <tr class="total-row">
                    <td>Total Paid</td>
                    <td style="text-align: right;">₦${receipt.financials.grossAmount.toLocaleString()}</td>
                </tr>
            </tbody>
        </table>

        <div class="footer">
            VeriTask Financial Services &bull; Automated Receipt &bull; Support: support@veritask.ng
        </div>
    </div>
</body>
</html>
        `;
    },
};

module.exports = ReceiptService;
