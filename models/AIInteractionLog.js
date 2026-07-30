const mongoose = require("mongoose");

const aiInteractionLogSchema = new mongoose.Schema({
    session: { type: mongoose.Schema.Types.ObjectId, ref: "ConversationSession" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    detectedLanguage: String,
    skillPrediction: String,
    confidence: Number,
    followUpsAsked: Number,
    userCorrected: { type: Boolean, default: false },
    finalSkill: String,
    matchedTalents: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // ref User since TalentProfile user references User, or we can ref User or TalentProfile as appropriate. Under match controller results, matches are talents mapped to their User ID, but either is fine. Let's make matchedTalents reference User to store the talent user IDs.
    matchAccepted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("AIInteractionLog", aiInteractionLogSchema);
