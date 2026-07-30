const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const Task = require("../models/Task");
const Notification = require("../models/Notification");
const PaymentService = require("../services/PaymentService");

// ─── Helper: deduplicated notification ───────────────────────────────────────
async function notify(recipientId, type, title, message, taskId = null) {
    try {
        const since = new Date(Date.now() - 60_000);
        const exists = await Notification.findOne({ recipient: recipientId, type, taskId, createdAt: { $gte: since } });
        if (!exists) await Notification.create({ recipient: recipientId, type, title, message, taskId });
    } catch (err) { console.error("Notification error:", err.message); }
}

// ─── Helper: ensure wallet exists ─────────────────────────────────────────────
async function ensureWallet(userId) {
    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) wallet = await Wallet.create({ user: userId });
    return wallet;
}

// ─── GET own wallet ───────────────────────────────────────────────────────────
const getWallet = async (req, res) => {
    try {
        const wallet = await ensureWallet(req.user._id);
        // Integrity check: recalculate balance from transaction log and self-heal if needed
        wallet.verifyBalance();
        res.json(wallet);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ─── REQUEST WITHDRAWAL ───────────────────────────────────────────────────────
const requestWithdrawal = async (req, res) => {
    try {
        const { WITHDRAWAL_MINIMUM_NGN, WITHDRAWAL_MAXIMUM_NGN } = require("../constants/paymentConstants");
        if (!amount || amount < WITHDRAWAL_MINIMUM_NGN) {
            return res.status(400).json({ message: `Minimum withdrawal amount is ₦${WITHDRAWAL_MINIMUM_NGN.toLocaleString()}` });
        }
        if (amount > WITHDRAWAL_MAXIMUM_NGN) {
            return res.status(400).json({ message: `Maximum single withdrawal is ₦${WITHDRAWAL_MAXIMUM_NGN.toLocaleString()}` });
        }
        if (!accountName || !accountNumber || !bankName)
            return res.status(400).json({ message: "Bank details are required" });

        const wallet = await ensureWallet(req.user._id);
        wallet.verifyBalance();

        if (amount > wallet.balance) {
            return res.status(400).json({
                message: `Insufficient balance. Available: ${wallet.currency} ${wallet.balance.toLocaleString()}`,
            });
        }

        // Debit the wallet immediately to prevent double-withdrawal
        wallet.debit(amount, `Withdrawal to ${bankName} — ${accountNumber}`, null);

        // Record in withdrawal history with pending status
        const bankDetails = { accountName, accountNumber, bankName };
        const reference = `WD-${req.user._id}-${Date.now()}`;

        wallet.withdrawalHistory.push({
            amount, currency: wallet.currency,
            status: "pending",
            bankDetails,
            reference,
            requestedAt: new Date(),
        });

        await wallet.save();

        // Initiate via PaymentService (Paystack transfer when real)
        await PaymentService.initiateWithdrawal({
            amount, currency: wallet.currency, bankDetails,
            walletId: wallet._id, reference,
        }).catch((err) => console.error("PaymentService withdrawal error (non-blocking):", err.message));

        res.json({ message: "Withdrawal request submitted. Processing takes 1–3 business days.", wallet });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ─── ADMIN: get all wallets ───────────────────────────────────────────────────
const getAdminWallets = async (req, res) => {
    try {
        const wallets = await Wallet.find().populate("user", "name email role");
        const totalBalance = wallets.reduce((s, w) => s + w.balance, 0);
        const totalEarnings = wallets.reduce((s, w) => s + w.lifetimeEarnings, 0);
        const pendingWithdrawals = wallets.reduce(
            (s, w) => s + w.withdrawalHistory.filter((h) => h.status === "pending").reduce((a, h) => a + h.amount, 0), 0
        );
        res.json({ wallets, totalBalance, totalEarnings, pendingWithdrawals });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ─── ADMIN: adjust wallet balance (with full audit trail) ─────────────────────
const adminAdjustWallet = async (req, res) => {
    try {
        const { type, amount, description } = req.body;
        if (!["credit", "debit"].includes(type))
            return res.status(400).json({ message: "Type must be 'credit' or 'debit'" });
        if (!amount || amount <= 0)
            return res.status(400).json({ message: "Amount must be positive" });

        const wallet = await Wallet.findOne({ user: req.params.userId });
        if (!wallet) return res.status(404).json({ message: "Wallet not found" });

        wallet.verifyBalance();

        if (type === "debit" && amount > wallet.balance) {
            return res.status(400).json({ message: "Debit amount exceeds wallet balance" });
        }

        // ✅ Admin audit trail: adminId, timestamp, reason are stored in transaction metadata
        const auditDescription = `[ADMIN: ${req.user.name} | ${req.user._id} | ${new Date().toISOString()}] ${description || "Balance adjustment"}`;

        if (type === "credit") {
            wallet.credit(amount, auditDescription, null);
        } else {
            wallet.debit(amount, auditDescription, null);
        }

        await wallet.save();

        res.json({
            message: `Wallet ${type}ed ${wallet.currency} ${amount.toLocaleString()}`,
            wallet,
            audit: {
                adminId: req.user._id,
                adminName: req.user.name,
                type, amount,
                description: auditDescription,
                timestamp: new Date(),
            },
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ─── ADMIN: update withdrawal status ─────────────────────────────────────────
// Allows admin to move: pending → processing → completed/failed
const updateWithdrawalStatus = async (req, res) => {
    try {
        const { userId, withdrawalIndex } = req.params;
        const { status, notes } = req.body;

        const VALID_STATUSES = ["pending", "processing", "completed", "failed"];
        if (!VALID_STATUSES.includes(status))
            return res.status(400).json({ message: `Status must be one of: ${VALID_STATUSES.join(", ")}` });

        const wallet = await Wallet.findOne({ user: userId });
        if (!wallet) return res.status(404).json({ message: "Wallet not found" });

        const withdrawal = wallet.withdrawalHistory[Number(withdrawalIndex)];
        if (!withdrawal) return res.status(404).json({ message: "Withdrawal record not found" });

        // Prevent backward transitions (e.g. completed → pending)
        const ORDER = { pending: 0, processing: 1, completed: 2, failed: 2 };
        if (ORDER[status] < ORDER[withdrawal.status] && !(withdrawal.status === "pending" && status === "failed")) {
            return res.status(400).json({ message: `Cannot transition withdrawal from '${withdrawal.status}' → '${status}'` });
        }

        // If marking failed and it was deducted, refund the balance
        if (status === "failed" && withdrawal.status !== "failed") {
            wallet.credit(withdrawal.amount, `Withdrawal refund (failed) — ${withdrawal.bankDetails?.bankName}`, null);
        }

        withdrawal.status = status;
        if (notes) withdrawal.notes = notes;
        if (status === "completed" || status === "failed") withdrawal.processedAt = new Date();

        await wallet.save();

        await notify(wallet.user, "withdrawal_status_updated", `Withdrawal ${status.charAt(0).toUpperCase() + status.slice(1)}`,
            status === "completed"
                ? `Your withdrawal of ${wallet.currency} ${withdrawal.amount.toLocaleString()} has been completed.`
                : status === "failed"
                    ? `Your withdrawal request failed. The amount has been returned to your wallet.`
                    : `Your withdrawal is now ${status}.`,
            null
        );

        res.json({ message: `Withdrawal status updated to '${status}'`, wallet });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getWallet, requestWithdrawal,
    getAdminWallets, adminAdjustWallet, updateWithdrawalStatus,
};
