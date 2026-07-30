const express = require("express");
const router = express.Router();
const { register, login, getMe, getAdminStats, getPublicStats, refreshAccessToken, logout } = require("../controllers/authController");
const { protect, requireRole } = require("../middleware/authMiddleware");
const TalentProfile = require("../models/TalentProfile");
const User = require("../models/User");

router.post("/register", register);
router.post("/login", login);
router.get("/me", protect, getMe);

router.patch("/profile", protect, async (req, res) => {
  try {
    const { bio, portfolioUrl, skills, location, contactPreference } = req.body;

    if (location) {
      await User.findByIdAndUpdate(req.user._id, { location });
    }

    if (contactPreference) {
      await User.findByIdAndUpdate(
        req.user._id,
        { contactPreference },
        { new: true }
      );
    }

    if (req.user.role === "talent") {
      // Sanitize skills: ensure they are strings matching the exact enum values.
      // Guards against the frontend sending objects, wrong casing, or extra whitespace.
      const VALID_SKILLS = [
        "Graphic Design",
        "Data Analysis",
        "Cybersecurity",
        "Web Development",
        "IT Support & Maintenance",
        "Device Repair",
        "Digital Marketing",
        "Other",
      ];

      const sanitizedSkills = Array.isArray(skills)
        ? skills
          .map((s) => (typeof s === "object" && s !== null ? s.label || s.value || s.name : s))
          .map((s) => (typeof s === "string" ? s.trim() : ""))
          .filter((s) => VALID_SKILLS.includes(s))
        : undefined;

      console.log("PATCH /profile — incoming skills:", skills);
      console.log("PATCH /profile — sanitized skills:", sanitizedSkills);

      // Check current verificationStatus before updating.
      // Only promote "unverified" → "pending"; never touch "pending" or "verified".
      const existingProfile = await TalentProfile.findOne({ user: req.user._id });
      const updatePayload = { bio, portfolioUrl, skills: sanitizedSkills };
      if (!existingProfile || existingProfile.verificationStatus === "unverified") {
        updatePayload.verificationStatus = "pending";
      }

      await TalentProfile.findOneAndUpdate(
        { user: req.user._id },
        updatePayload,
        { new: true, upsert: true }
      );
    }

    res.json({ message: "Profile updated successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin stats (protected)
router.get("/admin/stats", protect, requireRole("admin"), getAdminStats);

// Public stats (no auth — landing page)
router.get("/public-stats", getPublicStats);

// Refresh access token (no auth — reads httpOnly cookie)
router.post("/refresh", refreshAccessToken);

// Logout — clears cookie + nulls DB refresh token
router.post("/logout", protect, logout);

// ── Onboarding wizard — saves required + optional profile fields ────────────
// Required: displayName, location.lga
// Optional: logoUrl, businessDescription, industry, incorporationNumber,
//           businessWebsite, socialLinks, contactPreference
// Sets isOnboarded: true so the frontend wizard doesn't re-appear.
router.patch("/onboarding", protect, async (req, res) => {
  try {
    const {
      displayName,
      location,
      contactPreference,
      // Optional profile enrichment
      logoUrl,
      businessDescription,
      industry,
      incorporationNumber,
      businessWebsite,
      socialLinks,
    } = req.body;

    if (!displayName || !location?.lga) {
      return res.status(400).json({
        message: "displayName and location.lga are required to complete onboarding.",
      });
    }

    const updateData = {
      displayName: displayName.trim(),
      location,
      isOnboarded: true,
    };

    if (contactPreference) updateData.contactPreference = contactPreference;

    // Optional profile fields — only set if provided
    const profileUpdate = {};
    if (logoUrl !== undefined) profileUpdate["profile.logoUrl"] = logoUrl;
    if (businessDescription !== undefined) profileUpdate["profile.businessDescription"] = businessDescription;
    if (industry !== undefined) profileUpdate["profile.industry"] = industry;
    if (incorporationNumber !== undefined) profileUpdate["profile.incorporationNumber"] = incorporationNumber;
    if (businessWebsite !== undefined) profileUpdate["profile.businessWebsite"] = businessWebsite;
    if (socialLinks) profileUpdate["profile.socialLinks"] = socialLinks;

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { ...updateData, ...profileUpdate },
      { new: true, select: "-password -refreshToken" }
    );

    res.json({ message: "Onboarding complete.", user: updated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;