const mongoose = require("mongoose");
const Task = require("../models/Task");
const ProjectSubmission = require("../models/ProjectSubmission");
const Notification = require("../models/Notification");
const { uploadToCloudinary } = require("../services/cloudinaryService");

// ─── Helper: deduplicated notification ───────────────────────────────────────
async function notify(recipientId, type, title, message, taskId = null, metadata = {}) {
    try {
        const since = new Date(Date.now() - 60_000);
        const exists = await Notification.findOne({ recipient: recipientId, type, taskId, createdAt: { $gte: since } });
        if (exists) return;
        await Notification.create({ recipient: recipientId, type, title, message, taskId, metadata });
    } catch (err) {
        console.error("Notification error:", err.message);
    }
}

// ─── Helper: check task authorization ────────────────────────────────────────
function isAuthorizedForTask(task, user) {
    if (!user || !task) return false;
    if (user.role === "admin") return true;
    const userIdStr = user._id.toString();
    const ownerIdStr = task.businessOwner._id ? task.businessOwner._id.toString() : task.businessOwner.toString();
    const talentIdStr = task.assignedTalent ? (task.assignedTalent._id ? task.assignedTalent._id.toString() : task.assignedTalent.toString()) : null;
    return userIdStr === ownerIdStr || (talentIdStr && userIdStr === talentIdStr);
}

// ─── AI Deliverable Checklist Recommendations by Category ────────────────────
const AI_RECOMMENDATIONS = {
    "Software Development": {
        suggestedTypes: ["GitHub Repository Link", "Live Demo URL", "Source Code ZIP", "API Documentation", "Video Walkthrough"],
        checklist: [
            "Ensure all repository secrets and environment variables are excluded",
            "Include a detailed README with setup and deployment instructions",
            "Verify production build runs without TypeScript/lint errors",
            "Provide live demo link or staging environment URL",
        ],
    },
    "UI/UX Design": {
        suggestedTypes: ["Figma / Adobe XD Link", "Design Specs PDF", "Exported Assets ZIP", "Interactive Prototype"],
        checklist: [
            "Ensure Figma view/edit permissions are correctly configured",
            "Include mobile and desktop design frames",
            "Export high-resolution PNG/SVG assets",
            "Provide component design system / style guide",
        ],
    },
    "Data Analysis & Visualization": {
        suggestedTypes: ["Dashboard Link (Tableau/PowerBI)", "Cleaned Dataset CSV/XLSX", "PDF Analysis Report", "Jupyter Notebook"],
        checklist: [
            "Include methodology and summary of findings",
            "Verify dataset columns and data types are clearly documented",
            "Export interactive dashboard or high-res chart images",
        ],
    },
    "Graphic Design": {
        suggestedTypes: ["Source File (PSD/AI)", "High-Res Exports (PNG/JPEG/SVG)", "Print-Ready PDF", "Brand Guidelines"],
        checklist: [
            "Provide CMYK print-ready and RGB web versions",
            "Include embedded fonts or outlines",
            "Provide transparent background PNGs",
        ],
    },
    "Web Development": {
        suggestedTypes: ["Live Website URL", "GitHub Repository", "CMS Admin Credentials", "Deployment Guide"],
        checklist: [
            "Test responsiveness across mobile, tablet, and desktop viewports",
            "Verify SSL certificate and custom domain setup",
            "Include admin login credentials if applicable",
        ],
    },
    Default: {
        suggestedTypes: ["External Resource Link", "Document PDF/DOCX", "Zip Archive", "Preview Image / Video"],
        checklist: [
            "Double-check all deliverables match the agreed project scope",
            "Provide clear instructions for testing or reviewing the work",
            "Include source files where applicable",
        ],
    },
};

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET WORKSPACE DATA
// ═════════════════════════════════════════════════════════════════════════════
const getWorkspaceData = async (req, res) => {
    try {
        const { taskId } = req.params;
        const task = await Task.findById(taskId)
            .populate("businessOwner", "name email phone location contactPreference profile")
            .populate("assignedTalent", "name email phone profile");

        if (!task) return res.status(404).json({ message: "Project not found" });

        // Strict IDOR & Authorization check
        if (!isAuthorizedForTask(task, req.user)) {
            return res.status(403).json({ message: "Unauthorized access to this project workspace." });
        }

        const submissions = await ProjectSubmission.find({ taskId })
            .populate("submittedBy", "name email")
            .sort({ version: -1 });

        const aiRecs = AI_RECOMMENDATIONS[task.category] || AI_RECOMMENDATIONS["Default"];

        res.json({
            task,
            submissions,
            latestSubmission: submissions[0] || null,
            totalVersions: submissions.length,
            aiRecommendations: aiRecs,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// 2. UPLOAD DELIVERABLE FILE (Cloudinary Direct In-Memory Upload)
// ═════════════════════════════════════════════════════════════════════════════
const uploadDeliverableFile = async (req, res) => {
    try {
        const { taskId } = req.params;
        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: "Project not found" });

        if (!isAuthorizedForTask(task, req.user)) {
            return res.status(403).json({ message: "Unauthorized file upload." });
        }

        if (!req.file) {
            return res.status(400).json({ message: "No file provided for upload." });
        }

        // Direct in-memory buffer upload to Cloudinary (no local disk storage!)
        const cloudResult = await uploadToCloudinary(
            req.file.buffer,
            req.file.originalname,
            req.file.mimetype
        );

        res.json({
            url: cloudResult.secure_url,
            publicId: cloudResult.public_id,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            mimeType: req.file.mimetype,
            format: cloudResult.format,
        });
    } catch (error) {
        console.error("Upload deliverable error:", error);
        res.status(500).json({ message: error.message || "File upload failed" });
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// 3. SUBMIT WORK (Talent)
// ═════════════════════════════════════════════════════════════════════════════
const submitWork = async (req, res) => {
    try {
        const { taskId } = req.params;
        const { summary, deliverables } = req.body;

        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: "Project not found" });

        // Authorization check
        if (task.assignedTalent?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Only the assigned talent can submit work for this project." });
        }

        // Lifecycle status guard
        const allowedStatuses = ["in_progress", "revision_requested", "funded"];
        if (!allowedStatuses.includes(task.status)) {
            return res.status(400).json({
                message: `Cannot submit work when project status is '${task.status}'. Must be in_progress or revision_requested.`,
            });
        }

        if (!summary || summary.trim().length === 0) {
            return res.status(400).json({ message: "Submission notes / summary are required." });
        }

        if (!deliverables || !Array.isArray(deliverables) || deliverables.length === 0) {
            return res.status(400).json({ message: "At least one deliverable item (link, file, or image) is required." });
        }

        // Determine version number
        const lastSubmission = await ProjectSubmission.findOne({ taskId }).sort({ version: -1 });
        const version = lastSubmission ? lastSubmission.version + 1 : 1;

        // Create immutable submission
        const submission = await ProjectSubmission.create({
            taskId: task._id,
            version,
            submittedBy: req.user._id,
            summary: summary.trim(),
            deliverables,
            status: "submitted_for_review",
        });

        // Update Task status & timeline
        task.status = "submitted_for_review";
        task.submittedAt = new Date();

        const isResubmission = version > 1;
        task.addTimeline(
            isResubmission ? `Work Resubmitted (v${version})` : `Work Submitted (v${version})`,
            isResubmission
                ? `Talent resubmitted updated deliverables for version ${version}.`
                : `Talent submitted completed project deliverables (v${version}) for client review.`,
            "talent"
        );

        await task.save();

        // Notify Business Owner
        await notify(
            task.businessOwner,
            "work_submitted",
            `Work Submitted for Review (v${version}) 📬`,
            `The talent submitted Version ${version} of the project deliverables. Please review them in the Project Workspace.`,
            task._id,
            { version, submissionId: submission._id }
        );

        res.status(201).json({
            message: `Work version ${version} submitted successfully!`,
            submission,
            task,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// 4. REQUEST REVISION (Client)
// ═════════════════════════════════════════════════════════════════════════════
const requestRevision = async (req, res) => {
    try {
        const { taskId } = req.params;
        const { notes, deadline } = req.body;

        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: "Project not found" });

        if (task.businessOwner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Only the project client can request revisions." });
        }

        if (!["submitted_for_review", "under_review"].includes(task.status)) {
            return res.status(400).json({ message: `Cannot request revision when project status is '${task.status}'.` });
        }

        if (!notes || notes.trim().length === 0) {
            return res.status(400).json({ message: "Revision notes are required." });
        }

        // Update latest submission record status
        const latestSubmission = await ProjectSubmission.findOne({ taskId }).sort({ version: -1 });
        if (latestSubmission) {
            latestSubmission.status = "revision_requested";
            latestSubmission.revisionRequestedAt = new Date();
            await latestSubmission.save();
        }

        // Update Task
        task.status = "revision_requested";
        task.revisionNotes.push({
            notes: notes.trim(),
            deadline: deadline ? new Date(deadline) : null,
            createdAt: new Date(),
        });

        task.addTimeline(
            "Revision Requested",
            `Client requested changes: "${notes.trim().slice(0, 100)}${notes.trim().length > 100 ? "…" : ""}"`,
            "client"
        );

        await task.save();

        // Notify Talent
        await notify(
            task.assignedTalent,
            "revision_requested",
            "Revision Requested 🔄",
            `The client requested changes for your submission. Please review their notes in the Project Workspace.`,
            task._id,
            { notes }
        );

        res.json({
            message: "Revision requested successfully.",
            task,
            latestSubmission,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// 5. APPROVE WORK (Client)
// ═════════════════════════════════════════════════════════════════════════════
const approveWork = async (req, res) => {
    try {
        const { taskId } = req.params;
        const task = await Task.findById(taskId);
        if (!task) return res.status(404).json({ message: "Project not found" });

        if (task.businessOwner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Only the project client can approve submitted work." });
        }

        if (!["submitted_for_review", "under_review"].includes(task.status)) {
            return res.status(400).json({ message: `Cannot approve work when project status is '${task.status}'.` });
        }

        // Update latest submission record
        const latestSubmission = await ProjectSubmission.findOne({ taskId }).sort({ version: -1 });
        if (latestSubmission) {
            latestSubmission.status = "approved";
            latestSubmission.approvedAt = new Date();
            await latestSubmission.save();
        }

        // Update Task
        task.status = "approved";
        task.approvedAt = new Date();
        task.addTimeline("Work Approved", "Client approved the submitted project deliverables.", "client");
        await task.save();

        // Notify Talent
        await notify(
            task.assignedTalent,
            "project_approved",
            "Work Approved! 🎉",
            "Your project deliverables have been approved by the client! Complete your review to release payment.",
            task._id
        );

        res.json({
            message: "Work approved successfully!",
            task,
            latestSubmission,
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getWorkspaceData,
    uploadDeliverableFile,
    submitWork,
    requestRevision,
    approveWork,
};
