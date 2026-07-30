/**
 * Turn 4 Task Completion Verification Script
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const fs = require("fs");

const SERVER_DIR = path.resolve(__dirname, "..");
const ConversationSession = require(path.join(SERVER_DIR, "models/ConversationSession"));
const AIInteractionLog = require(path.join(SERVER_DIR, "models/AIInteractionLog"));
const BASE = "http://localhost:5000";

async function login() {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "business@veritask.ng", password: "Business@1234" })
    });
    const data = await res.json();
    return data.token;
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
    return events.find(e => e.done);
}

async function main() {
    await mongoose.connect(process.env.MONGO_URI);
    const token = await login();

    const conversation = [
        { role: "user", content: "I need a website for my provision shop in Gombe" }
    ];

    let done = await sendSSE(token, conversation);
    const sessionId = done.sessionId;
    conversation.push({ role: "assistant", content: done.reply });

    console.log("Turn 1 Action:", done.action, "Skill:", done.skillCategory);

    conversation.push({ role: "user", content: "It is a public shop website for customers in Gombe LGA. Target deadline is in 2 weeks." });
    done = await sendSSE(token, conversation, sessionId);
    conversation.push({ role: "assistant", content: done.reply });
    console.log("Turn 2 Action:", done.action, "Skill:", done.skillCategory);

    conversation.push({ role: "user", content: "My budget is 200,000 NGN. Everything in the draft card looks perfect." });
    done = await sendSSE(token, conversation, sessionId);
    conversation.push({ role: "assistant", content: done.reply });
    console.log("Turn 3 Action:", done.action, "Reply:", done.reply.substring(0, 100));

    conversation.push({ role: "user", content: "Yes, I approve! Please complete the task and post it now." });
    done = await sendSSE(token, conversation, sessionId);
    console.log("Turn 4 Action:", done.action, "Skill:", done.skillCategory);

    const sessionDoc = await ConversationSession.findById(sessionId);
    const logDoc = await AIInteractionLog.findOne({ session: sessionId });

    console.log("\n--- MONGO DB DIRECT VERIFICATION ---");
    console.log("Session ID:", sessionId);
    console.log("Session Status in Mongo:", sessionDoc?.status);
    console.log("AIInteractionLog Document in Mongo:", logDoc);

    await mongoose.disconnect();
}

main().catch(console.error);
