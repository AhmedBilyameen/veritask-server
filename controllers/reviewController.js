const Review = require("../models/Review");
const TalentProfile = require("../models/TalentProfile");
const Task = require("../models/Task");
const Notification = require("../models/Notification");
const { releasePayment } = require("./taskController");

// ─── Helper: deduplicated notification ───────────────────────────────────────
async function notify(recipientId, type, title, message, taskId = null) {
  try {
    const since = new Date(Date.now() - 60_000);
    const exists = await Notification.findOne({ recipient: recipientId, type, taskId, createdAt: { $gte: since } });
    if (!exists) await Notification.create({ recipient: recipientId, type, title, message, taskId });
  } catch (err) { console.error("Notification error:", err.message); }
}

const recalculateRank = (profile) => {
  const { totalTasksCompleted, starRating, reliabilityFactor } = profile;
  const reliability = reliabilityFactor * 100;
  if (totalTasksCompleted >= 150 && starRating >= 4.9 && reliability >= 95) return "Legend";
  if (totalTasksCompleted >= 100 && starRating >= 4.8 && reliability >= 93) return "Elite";
  if (totalTasksCompleted >= 75 && starRating >= 4.7 && reliability >= 90) return "Master";
  if (totalTasksCompleted >= 50 && starRating >= 4.5 && reliability >= 88) return "Expert";
  if (totalTasksCompleted >= 30 && starRating >= 4.2 && reliability >= 85) return "Senior";
  if (totalTasksCompleted >= 15 && starRating >= 4.0 && reliability >= 80) return "Pro";
  if (totalTasksCompleted >= 5 && starRating >= 3.5 && reliability >= 75) return "Skilled";
  return "Junior";
};

// ─── POST /api/reviews ─────────────────────────────────────────────────────────
// Client submits review → payment released.
// ✅ Check 5 (user request): Reviews are immutable after submission (no PUT/PATCH endpoint).
//    The existingReview guard below enforces this at the data layer too —
//    attempting to POST a second review for the same task returns 400.
const submitReview = async (req, res) => {
  try {
    const {
      taskId, starRating, qualityRating, communicationRating,
      professionalismRating, wasOnTime, wouldHireAgain, comment,
    } = req.body;

    if (!starRating || !qualityRating || !communicationRating || !professionalismRating) {
      return res.status(400).json({ message: "All four rating dimensions are required" });
    }

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ message: "Task not found" });

    if (task.businessOwner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the client can review this task" });
    }

    // ✅ Immutability: one review per task per client — permanent
    const existingReview = await Review.findOne({ task: taskId, client: req.user._id });
    if (existingReview) {
      return res.status(400).json({
        message: "You have already submitted a review for this project. Reviews cannot be edited.",
      });
    }

    // Must be in 'approved' state to submit review
    const reviewableStatuses = ["approved"];
    if (!reviewableStatuses.includes(task.status)) {
      return res.status(400).json({
        message: `Work must be approved before you can review it. Current status: '${task.status}'.`,
      });
    }

    const talentId = task.assignedTalent;

    // Create the review first (safe: duplicate guard at L53 prevents double-submit).
    // We do NOT mutate task flags yet — if releasePayment() throws, the task stays
    // in 'approved' and the whole operation is safely retryable.
    const review = await Review.create({
      task: taskId,
      client: req.user._id,
      talent: talentId,
      starRating, qualityRating, communicationRating,
      professionalismRating,
      wasOnTime, wouldHireAgain: wouldHireAgain || false,
      comment,
      submittedAt: new Date(),
    });

    // Update TalentProfile stats
    const profile = await TalentProfile.findOne({ user: talentId });
    if (profile) {
      const allReviews = await Review.find({ talent: talentId });
      const avgRating =
        allReviews.reduce((sum, r) => {
          const avg =
            ((r.starRating) + (r.qualityRating || r.starRating) +
              (r.communicationRating || r.starRating) + (r.professionalismRating || r.starRating)) / 4;
          return sum + avg;
        }, 0) / allReviews.length;

      profile.starRating = Math.round(avgRating * 10) / 10;
      profile.totalTasksCompleted = allReviews.length;
      if (wasOnTime) profile.totalTasksOnTime = (profile.totalTasksOnTime || 0) + 1;
      profile.reliabilityFactor =
        profile.totalTasksCompleted > 0 ? profile.totalTasksOnTime / profile.totalTasksCompleted : 0;
      profile.calculateTrustScore?.();
      profile.rank = recalculateRank(profile);
      await profile.save();
    }

    // Notify talent early (informational, non-blocking)
    await notify(talentId, "review_submitted", "Your Work Was Reviewed ⭐",
      `The client gave you ${starRating}/5 stars. Payment release initiated…`, taskId);

    // ─── KEY: Release payment ───────────────────────────────────────────────
    // releasePayment() is atomic: handles its own escrow guard, state machine,
    // session, and wallet credit. Throws on failure → we return 500.
    await releasePayment(task._id);

    // ✅ Only commit task review flags AFTER payment release succeeds.
    // This prevents permanent orphaned state if releasePayment throws.
    task.addTimeline(
      "Client Review Submitted",
      `Client rated the work ${starRating}/5 stars. Payment released.`,
      "client"
    );
    task.clientReviewSubmitted = true;
    task.clientConfirmed = true;
    task.clientConfirmedAt = new Date();
    await task.save();

    const updatedTask = await Task.findById(taskId);
    res.status(201).json({
      review,
      updatedTrustScore: profile?.trustScore,
      task: updatedTask,
      message: "Review submitted and payment released successfully.",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── GET /api/reviews/talent/:talentId ───────────────────────────────────────
const getTalentReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ talent: req.params.talentId })
      .populate("client", "name")
      .populate("task", "category scope title status")
      .sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── GET /api/reviews/admin ───────────────────────────────────────────────────
const getAdminReviews = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const total = await Review.countDocuments();
    const reviews = await Review.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate("client", "name email")
      .populate("talent", "name email")
      .populate("task", "title category status");
    res.json({ reviews, total, page: Number(page) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { submitReview, getTalentReviews, getAdminReviews };