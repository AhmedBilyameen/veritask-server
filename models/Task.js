const mongoose = require("mongoose");

// ─── Valid status transitions (state machine) ─────────────────────────────────
const VALID_TRANSITIONS = {
  draft: ["open", "pending_talent_response", "cancelled"],
  open: ["pending_talent_response", "cancelled"],
  pending_talent_response: ["accepted", "declined_by_talent", "cancelled", "expired"],
  accepted: ["awaiting_funding", "cancelled"],
  declined_by_talent: ["pending_talent_response", "archived", "cancelled"],
  cancelled: [],
  expired: ["archived"],
  archived: [],
  awaiting_funding: ["funded", "cancelled"],
  funded: ["in_progress"],
  in_progress: ["submitted_for_review", "cancelled"],
  submitted_for_review: ["under_review"],
  under_review: ["revision_requested", "approved"],
  revision_requested: ["submitted_for_review", "cancelled"],
  approved: ["payment_released"],
  payment_released: ["completed"],
  completed: ["closed"],
  closed: [],
};

const taskSchema = new mongoose.Schema(
  {
    // ── Core identifiers ─────────────────────────────────────────────────────
    businessOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    assignedTalent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ── Job details ───────────────────────────────────────────────────────────
    title: {
      type: String,
      default: "",
      trim: true,
    },
    category: {
      type: String,
      enum: [
        "Software Development",
        "UI/UX Design",
        "Data Analysis & Visualization",
        "Quality Assurance",
        "Product Management",
        "Data Science",
        "Animation",
        "AI/Machine Learning",
        "Cybersecurity",
        "Game Development",
        "Cloud Computing",
        "DevOps",
        // Legacy categories for backward compatibility
        "Graphic Design",
        "Data Analysis",
        "Web Development",
        "IT Support & Maintenance",
        "Device Repair",
        "Digital Marketing",
        "Other",
      ],
      required: true,
    },
    scope: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    deliverables: {
      type: [String],
      default: [],
    },
    attachments: {
      type: [String],
      default: [],
    },
    deadline: {
      type: Date,
      required: true,
    },
    urgency: {
      type: String,
      enum: ["standard", "high", "urgent"],
      default: "standard",
    },
    location: {
      lga: { type: String, required: true },
      area: { type: String },
    },
    projectType: {
      type: String,
      enum: ["one-time", "ongoing"],
      required: true,
    },

    // ── Status ────────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        "draft",
        "open",
        "pending_talent_response",
        "accepted",
        "declined_by_talent",
        "cancelled",
        "expired",
        "archived",
        "awaiting_funding",
        "funded",
        "in_progress",
        "submitted_for_review",
        "under_review",
        "revision_requested",
        "approved",
        "payment_released",
        "completed",
        "closed",
      ],
      default: "open",
    },

    // ── Budget & Escrow ───────────────────────────────────────────────────────
    budget: {
      amount: { type: Number, default: null },
      currency: { type: String, default: "NGN" },
      type: { type: String, enum: ["fixed", "hourly"], default: "fixed" },
      isLocked: { type: Boolean, default: false },
      acceptedAmount: { type: Number, default: null },
      pricingGuidanceState: { type: String, enum: ["within_range", "below_range", "above_range", "none"], default: "none" },
    },
    escrow: {
      amount: { type: Number, default: 0 },
      currency: { type: String, default: "NGN" },
      fundedAt: { type: Date, default: null },
      releasedAt: { type: Date, default: null },
    },

    // ── Communication ─────────────────────────────────────────────────────────
    clientContact: {
      method: { type: String, default: "" },
      language: { type: String, default: "English" },
    },

    // ── Decline ───────────────────────────────────────────────────────────────
    declineReason: {
      reason: {
        type: String,
        enum: [
          "Budget is too low",
          "Deadline is unrealistic",
          "Requirements are unclear",
          "Outside my expertise",
          "Currently unavailable",
          "Other",
        ],
        default: null,
      },
      customText: { type: String, default: "" },
    },

    // ── Revisions ─────────────────────────────────────────────────────────────
    revisionNotes: [
      {
        notes: { type: String, required: true },
        deadline: { type: Date, default: null },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    // ── Timeline / Activity Log ───────────────────────────────────────────────
    timeline: [
      {
        event: { type: String, required: true },
        description: { type: String, default: "" },
        actor: { type: String, enum: ["client", "talent", "system"], default: "system" },
        timestamp: { type: Date, default: Date.now },
      },
    ],

    // ── Review flags ──────────────────────────────────────────────────────────
    clientReviewSubmitted: { type: Boolean, default: false },
    talentReviewSubmitted: { type: Boolean, default: false },

    // ── Legacy / AI ───────────────────────────────────────────────────────────
    aiMatchTicket: { type: String },
    inputLanguage: { type: String, default: "English" },

    // ── Timestamps for lifecycle events ───────────────────────────────────────
    talentAcceptedAt: { type: Date, default: null },
    talentDeclinedAt: { type: Date, default: null },
    fundedAt: { type: Date, default: null },
    workStartedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    clientConfirmed: { type: Boolean, default: false },
    clientConfirmedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ─── Static helper: check if transition is valid ──────────────────────────────
taskSchema.statics.isValidTransition = function (from, to) {
  const allowed = VALID_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
};

// ─── Database Indexes ───────────────────────────────────────────────────────────
taskSchema.index({ businessOwner: 1, createdAt: -1 });
taskSchema.index({ assignedTalent: 1, status: 1 });
taskSchema.index({ status: 1 });
taskSchema.index({ category: 1, status: 1 });

taskSchema.statics.VALID_TRANSITIONS = VALID_TRANSITIONS;

// ─── Instance method: add timeline entry ──────────────────────────────────────
taskSchema.methods.addTimeline = function (event, description, actor = "system") {
  this.timeline.push({ event, description, actor, timestamp: new Date() });
};

module.exports = mongoose.model("Task", taskSchema);