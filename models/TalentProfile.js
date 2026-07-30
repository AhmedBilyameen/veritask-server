const mongoose = require("mongoose");

const talentProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    skills: [
      {
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
      },
    ],
    bio: {
      type: String,
      maxlength: 300,
    },
    portfolioUrl: {
      type: String,
    },
    verificationStatus: {
      type: String,
      enum: ["unverified", "pending", "verified"],
      default: "unverified",
    },
    trustScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    starRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reliabilityFactor: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    totalTasksCompleted: {
      type: Number,
      default: 0,
    },
    totalTasksOnTime: {
      type: Number,
      default: 0,
    },
    totalRevisions: {
      type: Number,
      default: 0,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    rank: {
      type: String,
      enum: ["Junior", "Skilled", "Pro", "Senior", "Expert", "Master", "Elite", "Legend"],
      default: "Junior",
    },
  },
  { timestamps: true }
);

talentProfileSchema.methods.calculateTrustScore = function () {
  const starComponent = (this.starRating / 5) * 100 * 0.4;
  const reliabilityComponent = this.reliabilityFactor * 100 * 0.6;
  let score = starComponent + reliabilityComponent;
  if (this.reliabilityFactor < 0.8) {
    score = score * 0.5;
  }
  this.trustScore = Math.round(score);
  return this.trustScore;
};

module.exports = mongoose.model("TalentProfile", talentProfileSchema);