const TalentProfile = require("../models/TalentProfile");
const User = require("../models/User");
const Task = require("../models/Task");

const findMatches = async (req, res) => {
  try {
    const { taskId } = req.params;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    // Find ALL talent users nationwide
    const talentUsers = await User.find({
      role: "talent",
    }).select("_id name email location");

    const userIds = talentUsers.map((u) => u._id);

    // Escape special regex chars for safety
    const safeCategory = (task.category || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const categoryRegex = new RegExp(safeCategory, "i");

    // Query ALL available talent profiles for matching skill (or all if category is generic/empty)
    const skillQuery = task.category
      ? { skills: { $elemMatch: { $regex: categoryRegex } } }
      : {};

    let profiles = await TalentProfile.find({
      user: { $in: userIds },
      ...skillQuery,
      isAvailable: true,
    }).populate("user", "name email location");

    // Fallback: If no exact skill match found, return all available talents nationwide
    if (profiles.length === 0) {
      profiles = await TalentProfile.find({
        user: { $in: userIds },
        isAvailable: true,
      }).populate("user", "name email location");
    }

    const scored = profiles.map((profile) => {
      // Base trust score
      const starComponent = (profile.starRating / 5) * 100 * 0.4;
      const reliabilityComponent = profile.reliabilityFactor * 100 * 0.6;
      let trustScore = starComponent + reliabilityComponent;
      if (profile.reliabilityFactor < 0.8) trustScore = trustScore * 0.5;

      // Location bonus — same LGA gets +30 points
      const talentLGA = profile.user?.location?.lga?.toLowerCase().trim();
      const taskLGA = task.location?.lga?.toLowerCase().trim();
      const isLocalMatch = Boolean(talentLGA && taskLGA && talentLGA === taskLGA);
      const locationBonus = isLocalMatch ? 30 : 0;

      // Verification bonus — verified gets +15 points, pending gets +5
      const verificationBonus =
        profile.verificationStatus === "verified" ? 15 :
          profile.verificationStatus === "pending" ? 5 : 0;

      // Rank bonus
      const rankBonus = {
        Junior: 0, Skilled: 2, Pro: 4, Senior: 6,
        Expert: 8, Master: 10, Elite: 12, Legend: 15,
      }[profile.rank] || 0;

      const finalScore = Math.min(
        100,
        Math.round(trustScore + locationBonus + verificationBonus + rankBonus)
      );

      return {
        profile,
        finalScore,
        isLocalMatch,
      };
    });

    // Primary sort: Local matches first!
    // Secondary sort: Final calculated trust score descending
    scored.sort((a, b) => {
      if (a.isLocalMatch !== b.isLocalMatch) {
        return a.isLocalMatch ? -1 : 1;
      }
      return b.finalScore - a.finalScore;
    });

    const results = scored.map(({ profile, finalScore, isLocalMatch }) => ({
      talentId: profile.user._id,
      name: profile.user.name,
      email: profile.user.email,
      location: profile.user.location,
      skills: profile.skills,
      trustScore: finalScore,
      starRating: profile.starRating,
      reliabilityFactor: profile.reliabilityFactor,
      totalTasksCompleted: profile.totalTasksCompleted,
      verificationStatus: profile.verificationStatus,
      rank: profile.rank,
      bio: profile.bio,
      isLocalMatch,
    }));

    res.json({ task, matches: results });
  } catch (error) {
    console.error("findMatches error:", error);
    res.status(500).json({ message: error.message });
  }
};

const assignTalent = async (req, res) => {
  try {
    const { taskId, talentId } = req.body;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found" });
    }

    if (task.businessOwner.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: "Not authorized to assign this task",
      });
    }

    // Get client contact preferences
    const client = await User.findById(req.user._id)
      .select("contactPreference phone");

    task.assignedTalent = talentId;
    task.status = "pending_talent_response";
    task.clientContact = {
      method: client.contactPreference?.method || "phone",
      language: client.contactPreference?.language || "English",
    };

    await task.save();

    res.json({ message: "Talent assigned successfully", task });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/match/profile/:id
// Returns a talent's public profile — used by talent profile page and business match cards
const getTalentProfile = async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`[getTalentProfile] Fetching profile for talent id: ${id}`);

    const profile = await TalentProfile.findOne({ user: id }).populate(
      "user",
      "name email location"
    );

    if (!profile) {
      console.log(`[getTalentProfile] No TalentProfile found for ${id} — returning user shell`);
      const user = await User.findById(id).select("name email location");
      if (!user) {
        console.log(`[getTalentProfile] User ${id} not found in DB`);
        return res.status(404).json({ message: "User not found" });
      }

      return res.json({
        user,
        bio: "",
        skills: [],
        portfolioUrl: "",
        trustScore: 0,
        starRating: 0,
        reliabilityFactor: 1,
        totalTasksCompleted: 0,
        verificationStatus: "unverified",
        rank: "Junior",
        isAvailable: true,
      });
    }

    console.log(`[getTalentProfile] Profile found for ${profile.user?.name}`);

    const starComponent = (profile.starRating / 5) * 100 * 0.4;
    const reliabilityComponent = profile.reliabilityFactor * 100 * 0.6;
    let trustScore = starComponent + reliabilityComponent;
    if (profile.reliabilityFactor < 0.8) trustScore = trustScore * 0.5;

    res.json({
      user: profile.user,
      bio: profile.bio,
      skills: profile.skills,
      portfolioUrl: profile.portfolioUrl,
      trustScore: Math.round(trustScore),
      starRating: profile.starRating,
      reliabilityFactor: profile.reliabilityFactor,
      totalTasksCompleted: profile.totalTasksCompleted,
      verificationStatus: profile.verificationStatus,
      rank: profile.rank || "Junior",
      isAvailable: profile.isAvailable,
    });
  } catch (error) {
    console.error("[getTalentProfile] Error:", error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { findMatches, assignTalent, getTalentProfile };