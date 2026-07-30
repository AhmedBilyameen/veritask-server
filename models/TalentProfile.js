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
  const rel = Math.min(1, Math.max(0, typeof this.reliabilityFactor === "number" ? this.reliabilityFactor : 0));
  const star = Math.min(5, Math.max(0, typeof this.starRating === "number" ? this.starRating : 0));
  const starComponent = (star / 5) * 100 * 0.4;
  const reliabilityComponent = rel * 100 * 0.6;
  let score = starComponent + reliabilityComponent;
  if (rel < 0.8) {
    score = score * 0.5;
  }
  this.trustScore = Math.min(100, Math.max(0, Math.round(score)));
  return this.trustScore;
};

talentProfileSchema.pre("save", function (next) {
  if (typeof this.totalTasksCompleted === "number" && typeof this.totalTasksOnTime === "number") {
    if (this.totalTasksOnTime > this.totalTasksCompleted) {
      this.totalTasksOnTime = this.totalTasksCompleted;
    }
  }
  if (typeof this.reliabilityFactor === "number") {
    if (this.reliabilityFactor > 1) this.reliabilityFactor = 1;
    if (this.reliabilityFactor < 0) this.reliabilityFactor = 0;
  }
  if (typeof this.trustScore === "number") {
    if (this.trustScore > 100) this.trustScore = 100;
    if (this.trustScore < 0) this.trustScore = 0;
  }
  if (typeof next === "function") next();
});

module.exports = mongoose.model("TalentProfile", talentProfileSchema);