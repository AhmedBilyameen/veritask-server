const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ["credit", "debit", "withdrawal_request", "withdrawal_completed", "withdrawal_refund"],
        required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "NGN" },
    description: { type: String, default: "" },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    status: {
        type: String,
        enum: ["completed", "pending", "failed"],
        default: "completed",
    },
    createdAt: { type: Date, default: Date.now },
});

const walletSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        // NOTE: balance is a cached derived value.
        // Always call verifyBalance() before trusting or displaying it.
        balance: { type: Number, default: 0, min: 0 },
        pendingBalance: { type: Number, default: 0, min: 0 },
        lifetimeEarnings: { type: Number, default: 0, min: 0 },
        currency: { type: String, default: "NGN" },
        withdrawalHistory: [
            {
                amount: { type: Number, required: true, min: 0 },
                currency: { type: String, default: "NGN" },
                // ✅ Full withdrawal status lifecycle
                status: {
                    type: String,
                    enum: ["pending", "processing", "completed", "failed"],
                    default: "pending",
                },
                bankDetails: {
                    accountName: { type: String },
                    accountNumber: { type: String },
                    bankName: { type: String },
                },
                reference: { type: String, default: "" },
                requestedAt: { type: Date, default: Date.now },
                processedAt: { type: Date, default: null },
                notes: { type: String, default: "" },
            },
        ],
        transactions: [transactionSchema],
    },
    { timestamps: true }
);

// ─── Helper: credit wallet ─────────────────────────────────────────────────────
walletSchema.methods.credit = function (amount, description, taskId = null) {
    if (amount <= 0) throw new Error("Credit amount must be positive");
    this.balance += amount;
    this.lifetimeEarnings += amount;
    this.transactions.push({
        type: "credit",
        amount,
        currency: this.currency,
        description,
        taskId,
        status: "completed",
    });
};

// ─── Helper: debit wallet ──────────────────────────────────────────────────────
walletSchema.methods.debit = function (amount, description, taskId = null) {
    if (amount <= 0) throw new Error("Debit amount must be positive");
    if (amount > this.balance) throw new Error(`Insufficient balance: have ${this.balance}, need ${amount}`);
    this.balance -= amount;
    this.transactions.push({
        type: "debit",
        amount,
        currency: this.currency,
        description,
        taskId,
        status: "completed",
    });
};

// ─── Integrity check: recompute balance from transaction ledger ────────────────
// ✅ Check 4 (user request): balance = Σcredits − Σdebits
// Call this before reads and writes. If a discrepancy is found it self-heals
// and logs a warning — important for catching partial-update bugs.
walletSchema.methods.verifyBalance = function () {
    const computed = this.transactions.reduce((total, tx) => {
        if (tx.status !== "completed") return total;
        return tx.type === "credit" ? total + tx.amount : total - tx.amount;
    }, 0);

    const rounded = Math.round(computed * 100) / 100;
    if (Math.abs(this.balance - rounded) > 0.01) {
        console.warn(
            `[Wallet integrity] User ${this.user}: stored balance ${this.balance} ≠ computed ${rounded}. Self-healing.`
        );
        this.balance = rounded;
    }
    // Clamp to zero in case of rounding errors
    this.balance = Math.max(0, this.balance);
    return this.balance;
};

module.exports = mongoose.model("Wallet", walletSchema);
