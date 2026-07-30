const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    talent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    starRating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    qualityRating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    communicationRating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    professionalismRating: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
    },
    wasOnTime: {
      type: Boolean,
      required: true,
    },
    revisionCount: {
      type: Number,
      default: 0,
    },
    comment: {
      type: String,
      maxlength: 500,
    },
    wouldHireAgain: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Review", reviewSchema);