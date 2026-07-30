const mongoose = require("mongoose");

const deliverableItemSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
    },
    type: {
        type: String,
        enum: ["file", "link", "image"],
        required: true,
    },
    url: {
        type: String,
        required: true,
    },
    filePath: {
        type: String,
        default: null,
    },
    fileName: {
        type: String,
        default: null,
    },
    fileSize: {
        type: Number,
        default: null,
    },
    mimeType: {
        type: String,
        default: null,
    },
    description: {
        type: String,
        default: "",
    },
    previewUrl: {
        type: String,
        default: null,
    },
});

const projectSubmissionSchema = new mongoose.Schema(
    {
        taskId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Task",
            required: true,
            index: true,
        },
        version: {
            type: Number,
            required: true,
            default: 1,
        },
        submittedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        summary: {
            type: String,
            required: true,
        },
        deliverables: [deliverableItemSchema],
        status: {
            type: String,
            enum: ["submitted_for_review", "under_review", "revision_requested", "approved"],
            default: "submitted_for_review",
        },
        revisionRequestedAt: {
            type: Date,
            default: null,
        },
        approvedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

projectSubmissionSchema.index({ taskId: 1, version: -1 });

module.exports = mongoose.model("ProjectSubmission", projectSubmissionSchema);
