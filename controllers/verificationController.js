const Verification = require("../models/Verification");
const TalentProfile = require("../models/TalentProfile");
const User = require("../models/User");

// ---------------------------------------------------------------------------
// GET /status  — talent only
// ---------------------------------------------------------------------------
const getVerificationStatus = async (req, res) => {
    try {
        let doc = await Verification.findOne({ talent: req.user._id });

        if (!doc) {
            doc = await Verification.create({
                talent: req.user._id,
                stage: 1,
                status: "not_started",
            });
        }

        res.json(doc);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ---------------------------------------------------------------------------
// POST /assessment/launch  — talent only
// Generates a redirect URL to the third-party assessment platform.
// VeriTask passes the talentId so the platform can callback with results.
// ---------------------------------------------------------------------------
const getAssessmentLaunchUrl = async (req, res) => {
    try {
        const ASSESSMENT_PLATFORM_URL = process.env.ASSESSMENT_PLATFORM_URL;
        if (!ASSESSMENT_PLATFORM_URL) {
            return res.status(503).json({
                message: "Assessment platform URL is not configured. Please contact support.",
            });
        }

        let doc = await Verification.findOne({ talent: req.user._id });
        if (!doc) {
            doc = await Verification.create({
                talent: req.user._id,
                stage: 1,
                status: "not_started",
            });
        }

        if (doc.stage !== 1) {
            return res.status(400).json({ message: "Assessment is not the current stage." });
        }
        if (doc.assessment?.externalStatus === "completed") {
            return res.status(400).json({ message: "Assessment has already been completed." });
        }

        // Get the talent's primary skill for the correct assessment track
        const profile = await TalentProfile.findOne({ user: req.user._id });
        const primarySkill = profile?.skills?.[0] || "Other";

        // Build the redirect URL — the external platform uses talentId + skill
        // to serve the correct test. It will POST results back to /assessment/webhook.
        const callbackUrl = `${process.env.SERVER_URL || "http://localhost:5000"}/api/verification/assessment/webhook`;
        const params = new URLSearchParams({
            talentId: req.user._id.toString(),
            skill: primarySkill,
            callbackUrl,
            platform: "veritask",
        });

        const redirectUrl = `${ASSESSMENT_PLATFORM_URL}/start?${params.toString()}`;

        // Mark the record as pending_redirect
        doc.assessment.externalStatus = "pending_redirect";
        doc.assessment.redirectedAt = new Date();
        doc.status = "in_progress";
        await doc.save();

        res.json({
            redirectUrl,
            skill: primarySkill,
            message: "Redirect the talent to this URL to begin the assessment.",
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ---------------------------------------------------------------------------
// POST /assessment/webhook  — called by external assessment platform
// Receives score, percentage, pass/fail from the third-party testing engine.
// ---------------------------------------------------------------------------
const receiveAssessmentWebhook = async (req, res) => {
    try {
        // Optional: validate a shared secret header for security
        const webhookSecret = process.env.ASSESSMENT_WEBHOOK_SECRET;
        if (webhookSecret) {
            const incomingSecret = req.headers["x-assessment-secret"];
            if (incomingSecret !== webhookSecret) {
                return res.status(401).json({ message: "Invalid webhook secret." });
            }
        }

        const { talentId, score, percentage, pass, externalAssessmentId } = req.body;

        if (!talentId || score === undefined || pass === undefined) {
            return res.status(400).json({ message: "Missing required fields: talentId, score, pass." });
        }

        // Acknowledge quickly for the external platform
        res.status(200).json({ received: true });

        // Process asynchronously
        const doc = await Verification.findOne({ talent: talentId });
        if (!doc || doc.stage !== 1) {
            console.warn(`[AssessmentWebhook] No stage-1 record found for talent: ${talentId}`);
            return;
        }

        // Store the results
        doc.assessment.score = score;
        doc.assessment.percentage = percentage ?? null;
        doc.assessment.pass = pass;
        doc.assessment.externalAssessmentId = externalAssessmentId || null;
        doc.assessment.externalStatus = "completed";
        doc.assessment.completedAt = new Date();
        doc.assessment.rawResult = req.body;

        if (pass) {
            // Auto-advance to Stage 2 on pass
            doc.status = "not_started";
            doc.stage = 2;
            console.log(`[AssessmentWebhook] Talent ${talentId} PASSED — advanced to stage 2`);
        } else {
            // Fail: remain on stage 1, mark rejected so talent can retry
            doc.status = "rejected";
            doc.assessment.adminFeedback = `Assessment score: ${score}${percentage !== undefined ? ` (${percentage}%)` : ""}. Minimum passing score was not achieved. Please review your skills and try again.`;
            console.log(`[AssessmentWebhook] Talent ${talentId} FAILED — score: ${score}`);
        }

        await doc.save();
    } catch (error) {
        console.error("[AssessmentWebhook] Error:", error.message);
    }
};



// ---------------------------------------------------------------------------
// POST /portfolio  — talent only
// ---------------------------------------------------------------------------
const submitPortfolio = async (req, res) => {
    try {
        const { items } = req.body;

        const doc = await Verification.findOne({ talent: req.user._id });

        if (!doc || doc.stage !== 2) {
            return res.status(400).json({ message: "Complete assessment first" });
        }

        if (doc.status === "submitted" || doc.status === "approved") {
            return res.status(400).json({ message: "Portfolio already submitted" });
        }

        doc.portfolio.items = items;
        doc.portfolio.submittedAt = new Date();
        doc.status = "submitted";

        await doc.save();
        res.json(doc);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ---------------------------------------------------------------------------
// POST /cv  — talent only
// ---------------------------------------------------------------------------
const submitCV = async (req, res) => {
    try {
        const cvData = req.body;

        const doc = await Verification.findOne({ talent: req.user._id });

        if (!doc || doc.stage !== 3) {
            return res.status(400).json({ message: "Complete portfolio review first" });
        }

        doc.cv = {
            ...cvData,
            submittedAt: new Date(),
            adminFeedback: doc.cv?.adminFeedback,
        };
        doc.status = "submitted";

        await doc.save();
        res.json(doc);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ---------------------------------------------------------------------------
// POST /admin/review  — admin only
// ---------------------------------------------------------------------------
const adminReviewStage = async (req, res) => {
    try {
        const { talentId, stage, decision, feedback } = req.body;

        const doc = await Verification.findOne({ talent: talentId });
        if (!doc) {
            return res.status(404).json({ message: "Verification record not found" });
        }

        if (decision === "approved") {
            if (stage === 1) {
                // Advance to Stage 2
                doc.status = "not_started";
                doc.stage = 2;
                if (feedback) doc.assessment.adminFeedback = feedback;
            } else if (stage === 2) {
                // Advance to Stage 3
                doc.status = "not_started";
                doc.stage = 3;
                if (feedback) doc.portfolio.adminFeedback = feedback;
            } else if (stage === 3) {
                // All stages complete — mark verified
                doc.status = "approved";
                if (feedback) doc.cv.adminFeedback = feedback;

                await TalentProfile.findOneAndUpdate(
                    { user: talentId },
                    { verificationStatus: "verified" }
                );
                await User.findByIdAndUpdate(talentId, { isVerified: true });
            }
        } else if (decision === "rejected") {
            doc.status = "rejected";
            if (stage === 1 && feedback) doc.assessment.adminFeedback = feedback;
            if (stage === 2 && feedback) doc.portfolio.adminFeedback = feedback;
            if (stage === 3 && feedback) doc.cv.adminFeedback = feedback;
        }

        await doc.save();
        res.json(doc);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ---------------------------------------------------------------------------
// GET /admin/queue  — admin only
// ---------------------------------------------------------------------------
const getAdminVerificationQueue = async (req, res) => {
    try {
        const queue = await Verification.find({ status: "submitted" })
            .populate("talent", "name email")
            .sort({ updatedAt: 1 });

        res.json(queue);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ---------------------------------------------------------------------------
// GET /admin/detail/:talentId  — admin only
// ---------------------------------------------------------------------------
const getVerificationDetail = async (req, res) => {
    try {
        const { talentId } = req.params;
        const doc = await Verification.findOne({ talent: talentId }).populate("talent", "name email");
        if (!doc) {
            return res.status(404).json({ message: "Verification record not found" });
        }
        res.json(doc);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getVerificationStatus,
    getAssessmentLaunchUrl,
    receiveAssessmentWebhook,
    submitPortfolio,
    submitCV,
    adminReviewStage,
    getAdminVerificationQueue,
    getVerificationDetail,
};

// ---------------------------------------------------------------------------
// POST /assessment/skip  — dev/testing bypass (talent only)
// ---------------------------------------------------------------------------
const skipAssessment = async (req, res) => {
    try {
        let doc = await Verification.findOne({ talent: req.user._id });
        if (!doc) {
            doc = await Verification.create({
                talent: req.user._id,
                stage: 1,
                status: "not_started",
            });
        }

        doc.assessment.score = 100;
        doc.assessment.percentage = 100;
        doc.assessment.pass = true;
        doc.assessment.externalStatus = "completed";
        doc.assessment.completedAt = new Date();
        doc.assessment.adminFeedback = "Assessment skipped (Development Mode).";
        doc.stage = 2;
        doc.status = "not_started";

        await doc.save();
        res.json({ message: "Assessment skipped. Advanced to Stage 2 (Portfolio Review).", doc });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports.skipAssessment = skipAssessment;

