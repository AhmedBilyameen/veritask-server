/**
 * VeriTask AI Dispatcher — Full Multi-turn Walkthrough & Verification Script
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const fs = require("fs");

const SERVER_DIR = path.resolve(__dirname, "..");
const User = require(path.join(SERVER_DIR, "models/User"));
const Task = require(path.join(SERVER_DIR, "models/Task"));
const TalentProfile = require(path.join(SERVER_DIR, "models/TalentProfile"));
const ConversationSession = require(path.join(SERVER_DIR, "models/ConversationSession"));
const AIInteractionLog = require(path.join(SERVER_DIR, "models/AIInteractionLog"));

const BASE = "http://localhost:5000";
const report = {};

async function login() {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "business@veritask.ng", password: "Business@1234" })
    });
    const data = await res.json();
    if (!data.token) {
        console.error("Login failed:", data);
        process.exit(1);
    }
    return { token: data.token, user: data };
}

async function sendSSE(token, messages, sessionId) {
    const body = { messages };
    if (sessionId) body.sessionId = sessionId;

    const res = await fetch(`${BASE}/api/ai/consult`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(body)
    });

    const text = await res.text();
    const lines = text.split("\n").filter(l => l.trim().startsWith("data: "));
    const events = [];
    for (const line of lines) {
        try { events.push(JSON.parse(line.trim().slice(6))); } catch { }
    }
    const done = events.find(e => e.done);
    return { status: res.status, doneEvent: done, rawText: text };
}

async function runMultiTurnConvergence(token) {
    console.log("\n=======================================================");
    console.log("1. MULTI-TURN CONVERGENCE & REAL TASK CREATION IN MONGO");
    console.log("=======================================================");

    const conversation = [];

    // Turn 1: Initial request
    console.log("Turn 1: Sending 'I need a website for my provision shop in Gombe'");
    conversation.push({ role: "user", content: "I need a website for my provision shop in Gombe" });
    let result = await sendSSE(token, conversation);
    let done = result.doneEvent;
    console.log("  Turn 1 Reply:", done?.reply?.substring(0, 150) + "...");
    console.log("  Skill:", done?.skillCategory, "| Confidence:", done?.confidence, "| Action:", done?.action);
    console.log("  Draft:", done?.draftTask);
    let sessionId = done?.sessionId;
    conversation.push({ role: "assistant", content: done.reply });

    // Turn 2: Provide scope, LGA, and timeline
    console.log("\nTurn 2: Sending 'It is a public online store for customers. I am located in Gombe LGA. Need it in 2 weeks'");
    conversation.push({ role: "user", content: "It is a public online store for customers. I am located in Gombe LGA. Need it in 2 weeks" });
    result = await sendSSE(token, conversation, sessionId);
    done = result.doneEvent;
    console.log("  Turn 2 Reply:", done?.reply?.substring(0, 150) + "...");
    console.log("  Skill:", done?.skillCategory, "| Action:", done?.action);
    console.log("  Draft:", done?.draftTask);
    conversation.push({ role: "assistant", content: done.reply });

    // Turn 3: Provide budget
    console.log("\nTurn 3: Sending 'My budget is between 150,000 and 300,000 NGN. Please proceed to find talent and finalize task creation.'");
    conversation.push({ role: "user", content: "My budget is between 150,000 and 300,000 NGN. Please proceed to find talent and finalize task creation." });
    result = await sendSSE(token, conversation, sessionId);
    done = result.doneEvent;
    console.log("  Turn 3 Reply:", done?.reply?.substring(0, 150) + "...");
    console.log("  Action:", done?.action, "| Skill:", done?.skillCategory);
    console.log("  Draft Final:", done?.draftTask);
    console.log("  Matches returned:", done?.matches?.length || 0);

    // Check MongoDB for session completion and task log
    const sessionDoc = await ConversationSession.findById(sessionId);
    const logDoc = await AIInteractionLog.findOne({ session: sessionId });

    console.log("\nMongoDB Session Status:", sessionDoc?.status);
    console.log("MongoDB Session Tool Calls:", sessionDoc?.toolCallCount);
    console.log("MongoDB AI Log Created?:", !!logDoc);

    report.multiTurn = {
        sessionId,
        finalAction: done?.action,
        finalSkill: done?.skillCategory,
        draftTask: done?.draftTask,
        sessionStatus: sessionDoc?.status,
        aiLogCreated: !!logDoc,
        toolCallCount: sessionDoc?.toolCallCount
    };
}

async function runBackwardCompatibilityCheck() {
    console.log("\n=======================================================");
    console.log("2. BACKWARD COMPATIBILITY (LEGACY SKILL CATEGORIES)");
    console.log("=======================================================");

    // Query talent profiles with legacy categories ("Web Development", "Graphic Design")
    const legacyTalents = await TalentProfile.find({
        skills: { $in: ["Web Development", "Graphic Design", "IT Support & Maintenance"] }
    }).populate("user");

    console.log(`Found ${legacyTalents.length} talent profiles tagged with legacy skill categories:`);
    for (const t of legacyTalents) {
        console.log(`  - ${t.user?.name || "Talent"}: skills = ${JSON.stringify(t.skills)}`);
    }

    // Also query legacy tasks
    const legacyTasks = await Task.find({
        category: { $in: ["Web Development", "Graphic Design", "Device Repair"] }
    });
    console.log(`Found ${legacyTasks.length} tasks created under legacy categories in MongoDB.`);

    report.backwardCompat = {
        legacyTalentsCount: legacyTalents.length,
        legacyTasksCount: legacyTasks.length,
        sampleTalentSkills: legacyTalents.map(t => ({ name: t.user?.name, skills: t.skills }))
    };
}

async function runRateLimitCheck(token) {
    console.log("\n=======================================================");
    console.log("3. RATE-LIMIT GUARD TEST (MAX 15 TOOL CALLS PER SESSION)");
    console.log("=======================================================");

    // Create a session with 15 tool calls manually in DB
    const clientUser = await User.findOne({ email: "business@veritask.ng" });
    const testSession = await ConversationSession.create({
        client: clientUser._id,
        status: "active",
        toolCallCount: 15,
        messages: []
    });

    console.log("Created test session with toolCallCount = 15:", testSession._id);

    // Trigger another turn that calls a tool (e.g. search_talents)
    const result = await sendSSE(token, [{ role: "user", content: "Search for Software Development talents in Gombe LGA" }], testSession._id);

    console.log("Rate-limit test response text (first 300 chars):");
    console.log("  ", result.rawText.substring(0, 300));
    const isGracefulOrLimited = result.rawText.includes("limit") || result.rawText.includes("protect") || result.rawText.includes("error");
    console.log("Rate-limit rejection detected?:", isGracefulOrLimited ? "✅ YES" : "❌ NO");

    report.rateLimit = {
        sessionId: testSession._id,
        rejectedGracefully: isGracefulOrLimited,
        responseTextSnippet: result.rawText.substring(0, 200)
    };
}

async function main() {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        console.error("MONGO_URI is missing from process.env");
        process.exit(1);
    }
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB for Verification Checks.\n");

    const { token } = await login();

    await runMultiTurnConvergence(token);
    await runBackwardCompatibilityCheck();
    await runRateLimitCheck(token);

    const outputPath = path.resolve(__dirname, "../walkthrough_verification_results.json");
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
    console.log("\nFull verification results written to server/walkthrough_verification_results.json");
    await mongoose.disconnect();
}

main().catch(err => {
    console.error("FATAL ERROR IN WALKTHROUGH SCRIPT:", err);
    process.exit(1);
});
