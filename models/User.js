const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // ── Core auth fields ────────────────────────────────────────────────────
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["client", "talent", "admin"],
      required: true,
    },
    location: {
      lga: { type: String },
      area: { type: String },
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    refreshToken: {
      type: String,
      default: null,
    },
    contactPreference: {
      method: {
        type: String,
        enum: ["phone", "whatsapp", "email", "other"],
        default: "phone",
      },
      language: {
        type: String,
        enum: ["English", "Hausa", "Fulfulde", "Tangale", "Yoruba", "Igbo", "Other"],
        default: "English",
      },
      contactValue: { type: String, default: "" },
    },

    // ── Onboarding ───────────────────────────────────────────────────────────
    // Tracks whether the user has completed the lightweight onboarding wizard.
    // Only required fields (displayName, preferredLanguage, communicationMethod)
    // block the wizard; all business-identity fields below are fully optional.
    isOnboarded: {
      type: Boolean,
      default: false,
    },

    // Display name — may differ from legal name (e.g. "Amina's Tailoring" vs "Aminatu Sule")
    displayName: {
      type: String,
      default: "",
      trim: true,
    },

    // ── Optional Business/Personal Profile ───────────────────────────────────
    // These are presented in the wizard as optional and can be completed later.
    profile: {
      logoUrl: { type: String, default: null },
      businessDescription: { type: String, default: "" },
      industry: { type: String, default: "" },
      incorporationNumber: { type: String, default: "" }, // e.g. CAC RC number
      businessWebsite: { type: String, default: "" },
      socialLinks: {
        whatsapp: { type: String, default: "" },
        instagram: { type: String, default: "" },
        twitter: { type: String, default: "" },
        linkedin: { type: String, default: "" },
        facebook: { type: String, default: "" },
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
