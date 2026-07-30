const mongoose = require("mongoose");

const conversationSessionSchema = new mongoose.Schema({
    client: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    language: { type: String, enum: ["english", "hausa", "fulfulde", "tangale", "en", "ha", "ff", "tn"], default: "english" },
    messages: [{
        role: { type: String, enum: ["user", "assistant"] },
        content: String,
        timestamp: { type: Date, default: Date.now }
    }],
    currentHypothesis: {
        skill: String,
        confidence: Number,
        supportingSkills: [String]
    },
    followUpsAsked: { type: Number, default: 0 },
    toolCallCount: { type: Number, default: 0 }, // rate-limit guard
    draftTask: {
        title: String,
        description: String,
        budget: {
            min: Number,
            max: Number
        },
        deadline: Date,
        location: String
    },
    status: { type: String, enum: ["active", "completed", "abandoned"], default: "active" },
    createdAt: { type: Date, default: Date.now, expires: 86400 } // TTL auto-expire index after 24 hours
}, { timestamps: true });

module.exports = mongoose.model("ConversationSession", conversationSessionSchema);
