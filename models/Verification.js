const mongoose = require("mongoose");

// ─── Verification Model ────────────────────────────────────────────────────────
// Tracks a talent's three-stage verification:
//   Stage 1 — External Professional Assessment (outsourced to assessment platform)
//   Stage 2 — Portfolio Review (links/items submitted by talent, reviewed by admin)
//   Stage 3 — CV Builder (structured career profile reviewed by admin)

const verificationSchema = new mongoose.Schema(
    {
        talent: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },
        stage: {
            type: Number,
            default: 1,
        },
        status: {
            type: String,
            enum: ["not_started", "in_progress", "submitted", "approved", "rejected"],
            default: "not_started",
        },

        // ── Stage 1: External Assessment Results ──────────────────────────────
        // VeriTask does NOT host the assessment engine. It receives results from
        // the third-party assessment platform via webhook/API callback.
        assessment: {
            // Identifier from the external platform's session
            externalAssessmentId: { type: String, default: null },

            // Results received from the external platform
            score: { type: Number, default: null },
            percentage: { type: Number, default: null },
            pass: { type: Boolean, default: null },

            // Status of the external session
            // pending_redirect  — user has been redirected to the external platform
            // completed         — external platform sent back results via webhook
            // not_started       — user hasn't been redirected yet
            externalStatus: {
                type: String,
                enum: ["not_started", "pending_redirect", "completed"],
                default: "not_started",
            },

            // Timestamps
            redirectedAt: { type: Date, default: null },
            completedAt: { type: Date, default: null },

            // Raw payload received from external platform (for audit)
            rawResult: { type: mongoose.Schema.Types.Mixed, default: null },

            // Admin can override / add commentary after reviewing external results
            adminFeedback: { type: String, default: null },
        },

        // ── Stage 2: Portfolio Review ──────────────────────────────────────────
        portfolio: {
            items: [
                {
                    title: { type: String },
                    description: { type: String },
                    url: { type: String },
                },
            ],
            submittedAt: { type: Date },
            adminFeedback: { type: String },
        },

        // ── Stage 3: CV Builder ────────────────────────────────────────────────
        cv: {
            personalInfo: {
                fullName: { type: String },
                phone: { type: String },
                email: { type: String },
                address: { type: String },
            },
            professionalSummary: { type: String },
            skills: [{ type: String }],
            workExperience: [
                {
                    company: { type: String },
                    role: { type: String },
                    startDate: { type: String },
                    endDate: { type: String },
                    description: { type: String },
                },
            ],
            education: [
                {
                    institution: { type: String },
                    degree: { type: String },
                    field: { type: String },
                    year: { type: String },
                },
            ],
            certifications: [
                {
                    name: { type: String },
                    issuer: { type: String },
                    year: { type: String },
                },
            ],
            languages: [{ type: String }],
            availability: { type: String },
            employmentPreference: { type: String },
            submittedAt: { type: Date },
            adminFeedback: { type: String },
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Verification", verificationSchema);

