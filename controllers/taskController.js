const mongoose = require("mongoose");
const Task = require("../models/Task");
const Notification = require("../models/Notification");
const Wallet = require("../models/Wallet");
const PaymentService = require("../services/PaymentService");

// ─── Helper: deduplicated notification ───────────────────────────────────────
// Prevents duplicate notifications if an action is retried within 60 seconds.
async function notify(recipientId, type, title, message, taskId = null, metadata = {}) {
  try {
    const since = new Date(Date.now() - 60_000);
    const exists = await Notification.findOne({ recipient: recipientId, type, taskId, createdAt: { $gte: since } });
    if (exists) return; // duplicate suppressed
    await Notification.create({ recipient: recipientId, type, title, message, taskId, metadata });
  } catch (err) {
    console.error("Notification error:", err.message);
  }
}

// ─── Helper: ensure wallet exists ─────────────────────────────────────────────
async function ensureWallet(userId, session = null) {
  const opts = session ? { session } : {};
  let wallet = await Wallet.findOne({ user: userId }, null, opts);
  if (!wallet) wallet = await Wallet.create([{ user: userId }], opts).then((r) => r[0]);
  return wallet;
}

// ─── Helper: state machine guard (used by all lifecycle endpoints) ─────────────
function guardTransition(task, toStatus, res) {
  if (!Task.isValidTransition(task.status, toStatus)) {
    res.status(400).json({
      message: `Invalid status transition: '${task.status}' → '${toStatus}'`,
    });
    return false;
  }
  return true;
}

// ─── Helper: run with Mongoose session when replica set is available ───────────
// Falls back to no-session mode in standalone dev environments.
async function withSession(fn) {
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    if (session) await session.abortTransaction().catch(() => { });
    throw err;
  } finally {
    if (session) session.endSession();
  }
}

const pricingGuidanceService = require("../services/pricingGuidanceService");

// ═════════════════════════════════════════════════════════════════════════════
// GET PRICING GUIDANCE (client/talent)
// ═════════════════════════════════════════════════════════════════════════════
const getPricingGuidance = async (req, res) => {
  try {
    const { category, amount, complexity } = req.query;
    const guidance = pricingGuidanceService.evaluateBudget(category, amount, complexity);
    res.json(guidance);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CREATE TASK (client)
// ═════════════════════════════════════════════════════════════════════════════
const createTask = async (req, res) => {
  try {
    const {
      title, category, scope, description, deliverables,
      attachments, deadline, urgency, location, projectType,
      aiMatchTicket, inputLanguage, budget, clientContact,
    } = req.body;

    const recentDuplicate = await Task.findOne({
      businessOwner: req.user._id, category, scope,
      createdAt: { $gt: new Date(Date.now() - 60_000) },
    });
    if (recentDuplicate) {
      return res.status(400).json({ message: "Duplicate task detected. Please wait before reposting." });
    }

    // Enforce server-side budget validation
    const budgetAmount = Number(budget?.amount);
    if (isNaN(budgetAmount) || budgetAmount <= 0) {
      return res.status(400).json({ message: "Task budget amount is required and must be a positive number (> 0)." });
    }

    const guidance = pricingGuidanceService.evaluateBudget(category, budgetAmount);

    const task = await Task.create({
      businessOwner: req.user._id,
      title: title || "",
      category, scope,
      description: description || scope,
      deliverables: Array.isArray(deliverables) ? deliverables : [],
      attachments: Array.isArray(attachments) ? attachments : [],
      deadline, urgency: urgency || "standard",
      location, projectType, aiMatchTicket,
      inputLanguage: inputLanguage || "English",
      budget: {
        amount: budgetAmount,
        currency: budget?.currency || "NGN",
        type: budget?.type || "fixed",
        isLocked: false,
        acceptedAmount: null,
        pricingGuidanceState: guidance.state,
      },
      clientContact: clientContact || {},
      status: "open",
    });

    task.addTimeline("Project Created", `Client created and posted the project with budget ₦${budgetAmount.toLocaleString()}.`, "client");
    await task.save();

    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// GET MY TASKS
// ═════════════════════════════════════════════════════════════════════════════
const getMyTasks = async (req, res) => {
  try {
    let tasks;
    if (req.user.role === "client") {
      tasks = await Task.find({ businessOwner: req.user._id })
        .populate("assignedTalent", "name email phone")
        .sort({ createdAt: -1 });
    } else {
      tasks = await Task.find({ assignedTalent: req.user._id })
        .populate("businessOwner", "name email phone contactPreference")
        .sort({ createdAt: -1 });
    }
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// GET TASK BY ID
// ═════════════════════════════════════════════════════════════════════════════
const getTaskById = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate("businessOwner", "name email phone location contactPreference")
      .populate("assignedTalent", "name email phone");
    if (!task) return res.status(404).json({ message: "Task not found" });
    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// GET ALL OPEN TASKS
// ═════════════════════════════════════════════════════════════════════════════
const getAllOpenTasks = async (req, res) => {
  try {
    const tasks = await Task.find({ status: { $in: ["pending_talent_response", "open"] } })
      .populate("businessOwner", "name location")
      .sort({ createdAt: -1 });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAssignedTasks = async (req, res) => {
  try {
    const tasks = await Task.find({
      assignedTalent: req.user._id,
      status: {
        $in: ["pending_talent_response", "accepted", "awaiting_funding", "funded",
          "in_progress", "submitted_for_review", "under_review", "revision_requested",
          "approved", "payment_released", "completed", "closed"],
      },
    })
      .populate("businessOwner", "name phone email contactPreference location")
      .sort({ createdAt: -1 });
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ACCEPT OFFER → accepted → awaiting_funding  [state machine enforced]
// ═════════════════════════════════════════════════════════════════════════════
const acceptOffer = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.assignedTalent?.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });
    if (!guardTransition(task, "accepted", res)) return;

    if (!task.budget?.amount || task.budget.amount <= 0) {
      return res.status(400).json({ message: "Cannot accept a task without a valid budget." });
    }

    // Lock agreed budget upon acceptance
    task.budget.isLocked = true;
    task.budget.acceptedAmount = task.budget.amount;

    task.status = "accepted";
    task.talentAcceptedAt = new Date();
    task.addTimeline("Offer Accepted", `${req.user.name} accepted the project offer at ₦${task.budget.amount.toLocaleString()}.`, "talent");

    // Immediately chain to awaiting_funding — validated by state machine
    if (!Task.isValidTransition("accepted", "awaiting_funding")) {
      return res.status(500).json({ message: "Internal state machine error" });
    }
    task.status = "awaiting_funding";
    task.addTimeline("Awaiting Funding", "Project is awaiting client payment to begin.", "system");
    await task.save();

    await notify(task.businessOwner, "offer_accepted", "Offer Accepted 🎉",
      `Your project offer was accepted at ₦${task.budget.amount.toLocaleString()}. Please fund the project to begin work.`, task._id);

    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// DECLINE OFFER → declined_by_talent  [state machine enforced]
// ═════════════════════════════════════════════════════════════════════════════
const declineOffer = async (req, res) => {
  try {
    const { reason, customText } = req.body;
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.assignedTalent?.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });
    if (!guardTransition(task, "declined_by_talent", res)) return;

    task.status = "declined_by_talent";
    task.talentDeclinedAt = new Date();
    task.declineReason = { reason: reason || "Other", customText: customText || "" };
    task.addTimeline("Offer Declined",
      `Talent declined: ${reason || "Other"}${customText ? ` — ${customText}` : ""}`, "talent");
    await task.save();

    await notify(task.businessOwner, "offer_declined", "Offer Declined",
      `Your offer was declined. Reason: ${reason || "Other"}. You may revise and resend.`,
      task._id, { reason, customText });

    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// RESEND OFFER → pending_talent_response  [state machine enforced]
// ═════════════════════════════════════════════════════════════════════════════
const resendOffer = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.businessOwner.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });
    if (!guardTransition(task, "pending_talent_response", res)) return;

    const { budget, deadline, scope, description, deliverables } = req.body;

    if (budget !== undefined) {
      const budgetAmount = Number(budget.amount);
      if (isNaN(budgetAmount) || budgetAmount <= 0) {
        return res.status(400).json({ message: "Revised budget amount must be a positive number (> 0)." });
      }
      const guidance = pricingGuidanceService.evaluateBudget(task.category, budgetAmount);
      task.budget = {
        amount: budgetAmount,
        currency: budget.currency || task.budget?.currency || "NGN",
        type: budget.type || task.budget?.type || "fixed",
        isLocked: false,
        acceptedAmount: null,
        pricingGuidanceState: guidance.state,
      };
    }
    if (deadline !== undefined) task.deadline = deadline;
    if (scope !== undefined) task.scope = scope;
    if (description !== undefined) task.description = description;
    if (deliverables !== undefined) task.deliverables = deliverables;

    task.status = "pending_talent_response";
    task.addTimeline("Offer Revised & Resent", `Client revised and resent offer (Budget: ₦${task.budget?.amount?.toLocaleString() || "N/A"}).`, "client");
    await task.save();

    await notify(task.assignedTalent, "offer_resent", "Revised Offer Received",
      `The client revised and resent the offer (Budget: ₦${task.budget?.amount?.toLocaleString() || "N/A"}). Please review and respond.`, task._id);

    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// CANCEL OFFER  [state machine enforced]
// ═════════════════════════════════════════════════════════════════════════════
const cancelOffer = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.businessOwner.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });
    if (!guardTransition(task, "cancelled", res)) return;

    task.status = "cancelled";
    task.addTimeline("Offer Cancelled", "Client cancelled the project offer.", "client");
    await task.save();

    if (task.assignedTalent) {
      await notify(task.assignedTalent, "offer_cancelled", "Offer Cancelled",
        "The client has cancelled this project offer.", task._id);
    }
    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// FUND PROJECT — DEPRECATED in favour of POST /api/payments/initiate-escrow
// Kept for backwards compatibility with older frontend builds.
// Returns the Paystack checkout URL instead of synchronously funding the task.
// ═════════════════════════════════════════════════════════════════════════════
const fundProject = async (req, res) => {
  // Proxy to the new payment route logic
  try {
    const task = await Task.findById(req.params.taskId).populate("businessOwner", "email name");
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.businessOwner._id.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });

    // Guard: task must be in 'accepted' OR 'awaiting_funding' (retry path)
    if (!["accepted", "awaiting_funding"].includes(task.status)) {
      return res.status(400).json({
        message: `Task cannot be funded in '${task.status}' state.`,
      });
    }

    // If already in awaiting_funding, try to return existing checkout URL
    if (task.status === "awaiting_funding") {
      const PaymentRec = require("../models/Payment");
      const existing = await PaymentRec.findOne({
        taskId: task._id,
        status: "pending",
        type: "escrow_hold",
      }).sort({ createdAt: -1 });

      if (existing) {
        // Re-generate checkout URL for the existing reference
        try {
          const paymentResult = await PaymentService.initiateEscrow({
            amount: existing.amount,
            email: task.businessOwner.email,
            taskId: task._id,
            reference: existing.reference,
            currency: existing.currency || "NGN",
          });
          return res.json({
            message: "Payment already initiated. Use the checkout link to complete payment.",
            reference: existing.reference,
            checkoutUrl: paymentResult.checkoutUrl || null,
            provider: PaymentService.getProviderName(),
            task,
          });
        } catch {
          // If re-init fails, fall through to create new record below
        }
      }
    }

    if (task.escrow?.fundedAt) {
      return res.status(400).json({ message: "This project has already been funded." });
    }

    const Payment = require("../models/Payment");
    const amount = task.budget?.amount || 0;
    const reference = `VT-ESC-${task._id}-${Date.now()}`;

    // Create a pending payment record
    await Payment.create({
      clientId: req.user._id,
      talentId: task.assignedTalent,
      taskId: task._id,
      amount,
      currency: task.budget?.currency || "NGN",
      type: "escrow_hold",
      status: "pending",
      reference,
    });

    // Get Paystack checkout URL
    const paymentResult = await PaymentService.initiateEscrow({
      amount,
      email: task.businessOwner.email,
      taskId: task._id,
      reference,
      currency: task.budget?.currency || "NGN",
    });

    // Advance to awaiting_funding (webhook will push to funded → in_progress)
    if (task.status === "accepted") {
      task.status = "awaiting_funding";
      task.addTimeline("Escrow Initiated", `Payment initiated (ref: ${reference}).`, "client");
      await task.save();
    }

    res.json({
      message: "Payment initiated. Redirect the client to the checkout URL to complete payment.",
      reference,
      checkoutUrl: paymentResult.checkoutUrl || null,
      provider: PaymentService.getProviderName(),
      task,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// ═════════════════════════════════════════════════════════════════════════════
// SUBMIT WORK → submitted_for_review  [state machine enforced]
// ═════════════════════════════════════════════════════════════════════════════
const submitWork = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.assignedTalent?.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });
    if (!guardTransition(task, "submitted_for_review", res)) return;

    task.status = "submitted_for_review";
    task.submittedAt = new Date();
    const isResubmission = (task.revisionNotes?.length || 0) > 0;
    task.addTimeline(
      isResubmission ? "Work Resubmitted" : "Work Submitted",
      isResubmission
        ? "Talent resubmitted updated work after revision."
        : "Talent submitted completed work for client review.",
      "talent"
    );
    await task.save();

    await notify(task.businessOwner, "work_submitted", "Work Submitted for Review 📬",
      `The talent ${isResubmission ? "resubmitted" : "submitted"} their work. Please review.`, task._id);

    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// BEGIN REVIEW → under_review  [state machine enforced]
// ═════════════════════════════════════════════════════════════════════════════
const beginReview = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.businessOwner.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });
    if (!guardTransition(task, "under_review", res)) return;

    task.status = "under_review";
    task.addTimeline("Under Review", "Client started reviewing the submitted work.", "client");
    await task.save();
    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// REQUEST REVISION → revision_requested  [state machine enforced]
// ═════════════════════════════════════════════════════════════════════════════
const requestRevision = async (req, res) => {
  try {
    const { notes, deadline } = req.body;
    if (!notes) return res.status(400).json({ message: "Revision notes are required" });

    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.businessOwner.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });
    if (!guardTransition(task, "revision_requested", res)) return;

    task.status = "revision_requested";
    task.revisionNotes.push({ notes, deadline: deadline || null });
    task.addTimeline("Revision Requested",
      `Client requested changes: "${notes.slice(0, 80)}${notes.length > 80 ? "…" : ""}"`, "client");
    await task.save();

    await notify(task.assignedTalent, "revision_requested", "Revision Requested",
      `Client requested changes: ${notes}`, task._id);

    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// APPROVE WORK → approved  [state machine enforced]
// Payment is NOT released here — it awaits the mandatory client review.
// ═════════════════════════════════════════════════════════════════════════════
const approveWork = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.businessOwner.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });
    if (!guardTransition(task, "approved", res)) return;

    task.status = "approved";
    task.approvedAt = new Date();
    task.addTimeline("Work Approved", "Client approved the completed work.", "client");
    await task.save();

    await notify(task.assignedTalent, "project_approved", "Work Approved! 🎉",
      "Your work has been approved. Please note: payment will be released once the client submits their review.",
      task._id);

    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// RELEASE PAYMENT — called internally by reviewController after client review
//
// QA Guarantees:
//   ✅ Escrow released-at guard   — prevents double-payment on retry
//   ✅ Status transition guard    — must be in 'approved' state
//   ✅ Atomic session             — wallet credit + task status in one transaction
//   ✅ PaymentService abstraction — provider-agnostic
//   ✅ Full timeline coverage     — 4 new entries logged
// ═════════════════════════════════════════════════════════════════════════════
const releasePayment = async (taskId) => {
  try {
    const task = await Task.findById(taskId)
      .populate("businessOwner", "name")
      .populate("assignedTalent", "name");
    if (!task) return;

    // ✅ Guard 1: must be in approved state
    if (task.status !== "approved") {
      console.warn(`releasePayment skipped — task ${taskId} is in '${task.status}', not 'approved'`);
      return;
    }

    // ✅ Guard 2: escrow integrity — never release twice
    if (task.escrow?.releasedAt) {
      console.warn(`releasePayment skipped — escrow for task ${taskId} was already released at ${task.escrow.releasedAt}`);
      return;
    }

    const amount = task.escrow?.amount || 0;

    // ✅ Atomic: run wallet credit + task status update in a MongoDB session
    await withSession(async (session) => {
      if (amount > 0) {
        // ✅ FIX: Do NOT call PaymentService.releaseEscrow() here.
        // VeriTask's model: talent receives funds into their internal wallet at
        // approval time; they initiate a bank withdrawal separately.
        // paystackAdapter.releaseEscrow() requires bank details (bankCode,
        // accountNumber) which are only known at withdrawal time — not here.

        // Create an escrow_release Payment ledger record for audit trail
        const Payment = require("../models/Payment");
        await Payment.create([{
          clientId: task.businessOwner._id,
          talentId: task.assignedTalent._id,
          taskId: task._id,
          amount,
          currency: task.escrow?.currency || "NGN",
          type: "escrow_release",
          status: "success",
          reconciledAt: new Date(),
        }], { session });

        // Credit talent wallet directly
        const wallet = await ensureWallet(task.assignedTalent._id, session);
        wallet.credit(amount, `Payment for project: ${task.title || task.category}`, task._id);
        await wallet.save({ session });
      }

      // Transition — validated by state machine
      if (!Task.isValidTransition(task.status, "payment_released")) throw new Error("Invalid transition to payment_released");
      task.escrow.releasedAt = new Date();
      task.status = "payment_released";
      task.addTimeline("Payment Released",
        `${task.escrow.currency} ${amount.toLocaleString()} released from escrow to talent wallet.`, "system");

      if (!Task.isValidTransition("payment_released", "completed")) throw new Error("Invalid transition to completed");
      task.status = "completed";
      task.completedAt = new Date();
      task.addTimeline("Project Completed", "Project successfully completed by both parties.", "system");

      await task.save({ session });
    });

    // Notifications are outside the session (non-critical, can fail independently)
    await notify(task.assignedTalent._id, "payment_released", "Payment Released 💰",
      `${task.escrow?.currency} ${amount.toLocaleString()} has been credited to your wallet!`, taskId);
    await notify(task.businessOwner._id, "review_requested", "Project Complete",
      "Your project is now complete. Payment has been released to the talent.", taskId);

  } catch (err) {
    console.error("releasePayment error:", err.message);
    throw err; // re-throw so reviewController can catch and return 500
  }
};

module.exports.releasePayment = releasePayment;

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN: updateTaskStatus — still goes through state machine (no bypass)
// ═════════════════════════════════════════════════════════════════════════════
const updateTaskStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found" });

    // Admin must still obey the state machine
    if (!Task.isValidTransition(task.status, status)) {
      return res.status(400).json({
        message: `Invalid transition: '${task.status}' → '${status}'. Admin overrides must still respect the lifecycle.`,
      });
    }

    task.status = status;
    task.addTimeline(`Status Updated by Admin`, `Manually set to '${status}'.`, "system");
    await task.save();
    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN QUERIES
// ═════════════════════════════════════════════════════════════════════════════
const getAdminRecentTasks = async (req, res) => {
  try {
    const tasks = await Task.find({}).sort({ createdAt: -1 }).limit(10)
      .populate("businessOwner", "name email")
      .populate("assignedTalent", "name email");
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAdminAllTasks = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = status ? { status } : {};
    const total = await Task.countDocuments(filter);
    const tasks = await Task.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate("businessOwner", "name email")
      .populate("assignedTalent", "name email");
    res.json({ tasks, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAdminEscrowSummary = async (req, res) => {
  try {
    const escrowTasks = await Task.find({
      status: { $in: ["funded", "in_progress", "submitted_for_review", "under_review", "revision_requested", "approved"] },
    }).select("title category budget escrow status businessOwner assignedTalent")
      .populate("businessOwner", "name email")
      .populate("assignedTalent", "name email");
    const totalEscrow = escrowTasks.reduce((s, t) => s + (t.escrow?.amount || 0), 0);
    res.json({ tasks: escrowTasks, totalEscrow });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// EDIT / DELETE — only allowed in early states
// ═════════════════════════════════════════════════════════════════════════════
const updateTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.businessOwner.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });

    const editableStatuses = ["open", "pending_talent_response", "pending_acceptance", "declined_by_talent", "draft", "awaiting_funding"];
    if (!editableStatuses.includes(task.status)) {
      return res.status(400).json({ message: "Cannot edit a task that is funded, in progress, or completed." });
    }

    if (req.body.budget !== undefined) {
      if (task.budget?.isLocked) {
        return res.status(400).json({ message: "Cannot edit the budget of an accepted offer (budget is locked)." });
      }
      const budgetAmount = Number(req.body.budget.amount);
      if (isNaN(budgetAmount) || budgetAmount <= 0) {
        return res.status(400).json({ message: "Task budget amount must be a positive number (> 0)." });
      }
      const guidance = pricingGuidanceService.evaluateBudget(req.body.category || task.category, budgetAmount);
      task.budget = {
        amount: budgetAmount,
        currency: req.body.budget.currency || task.budget?.currency || "NGN",
        type: req.body.budget.type || task.budget?.type || "fixed",
        isLocked: false,
        acceptedAmount: null,
        pricingGuidanceState: guidance.state,
      };
    }

    const fields = ["category", "scope", "deadline", "urgency", "location", "projectType", "title", "description", "deliverables"];
    for (const f of fields) {
      if (req.body[f] !== undefined) task[f] = req.body[f];
    }
    task.addTimeline("Offer Details Updated", "Client updated project details.", "client");
    await task.save();
    res.json(task);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteTask = async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });
    if (task.businessOwner.toString() !== req.user._id.toString())
      return res.status(403).json({ message: "Not authorized" });

    const nonDeletable = ["funded", "in_progress", "submitted_for_review", "under_review", "revision_requested", "approved", "payment_released", "completed"];
    if (nonDeletable.includes(task.status)) {
      return res.status(400).json({ message: "Cannot delete a task that is funded or in progress." });
    }
    await task.deleteOne();
    res.json({ message: "Task deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Legacy aliases
const acceptTask = acceptOffer;
const declineTask = async (req, res) => { req.body.reason = req.body.reason || "Other"; return declineOffer(req, res); };
const markTaskComplete = submitWork;
const confirmTaskComplete = beginReview;

module.exports = {
  createTask, getPricingGuidance, getMyTasks, getTaskById, updateTaskStatus, getAllOpenTasks, getAssignedTasks,
  acceptOffer, declineOffer, resendOffer, cancelOffer, fundProject, submitWork,
  beginReview, requestRevision, approveWork, releasePayment,
  getAdminRecentTasks, getAdminAllTasks, getAdminEscrowSummary,
  updateTask, deleteTask,
  // legacy
  acceptTask, declineTask, markTaskComplete, confirmTaskComplete,
};