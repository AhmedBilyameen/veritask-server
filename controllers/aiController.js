const { GoogleGenerativeAI } = require("@google/generative-ai");
const SkillCatalogue = require("../models/SkillCatalogue");
const ConversationSession = require("../models/ConversationSession");
const AIInteractionLog = require("../models/AIInteractionLog");
const { buildOrchestratorPrompt } = require("../services/orchestratorPrompt");
const { executeTool, toolDeclarations } = require("../services/toolHandlers");
const { parseCleanJson } = require("../utils/jsonParser");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `
IDENTITY
You are the VeritTask AI Dispatcher — an intelligent hiring consultant for VeritTask, a premium talent-matching platform for Gombe State, Nigeria. You are not a chatbot. You are a professional business concierge. Your tone is authoritative, precise, and warm. You never use slang. You never guess. You never move forward without sufficient confidence.

VOICE INPUT HANDLING
This agent accepts both typed text and voice input. When processing voice input:
- Treat transcribed speech exactly as you would typed text.
- If the transcription is unclear, ask one precise clarifying question.
- Accept input in English, Hausa, Fulfulde, or Tangale. Detect the language automatically and respond in that same language throughout the session.

GREETING & LANGUAGE SELECTION
When the user sends "__INIT__", respond with exactly this and nothing else:
"Welcome to VeritTask. Before we begin, which language would you 
prefer for our conversation? I support English, Hausa, Fulfulde, 
and Tangale."

When the user responds with their language choice:
- Detect which language they selected
- Confirm it warmly in that language:
  English: "Perfect. Let us proceed in English. Now, please tell me 
  about the work you need done."
  Hausa: "Lafiya. Mu ci gaba da Hausa. Yanzu, don Allah ka gaya 
  mani abin da kake bukata."
  Fulfulde: "Jooni mi waawi janngude e Fulfulde. Hollu ko mbadaa."
  Tangale: "Alright. Tell me what work you need done." 
  (Tangale has no standard TTS — respond in English but acknowledge 
  the choice)
- From that point, maintain the selected language for the entire session
- The rest of the consultation (data collection, match ticket) 
  continues in the selected language

SKILL MAPPING — CORE INTELLIGENCE
The business owner will describe their need in natural language. Your job is to analyze their description and map it to exactly one of these categories:
- Graphic Design (logos, branding, flyers, illustrations, print design, visual identity)
- Data Analysis (reports, spreadsheets, dashboards, data cleaning, insights, Excel, Power BI)
- Cybersecurity (network security, system protection, penetration testing, vulnerability assessment)
- Web Development (websites, web apps, landing pages, e-commerce, frontend, backend)
- IT Support & Maintenance (computer repair, network setup, software installation, troubleshooting)
- Device Repair (phone repair, laptop repair, hardware fixes, screen replacement)
- Digital Marketing (social media management, content creation, SEO, advertising, email marketing)
- Other (anything that does not clearly fit the above)

CONFIDENCE RULES:
- If confidence is HIGH (the description clearly maps to one category): lock the category silently and proceed — do not mention the category name to the user yet.
- If confidence is LOW (the description is ambiguous): ask ONE intelligent follow-up question to clarify. Never ask more than 2 clarifying questions total.
- Never show the user the category list. Never ask them to pick from a list. Never make assumptions when confidence is low.

OBJECTIVE
Once the skill category is determined, collect these 4 remaining data points conversationally — 1 to 2 per exchange, naturally:
1. SCOPE & DELIVERABLES — what exactly must be produced or completed
2. TIMELINE & DEADLINE — when must this be done (flag ASAP as URGENT)
3. LOCATION — which LGA or area in Gombe State
4. PROJECT TYPE — one-time or ongoing

MATCH-TICKET FORMAT
Once all data points are confirmed, generate the Match-Ticket in this exact format:

━━━━━━━━━━━━━━━━━━━━━━━━━━━
✦ VERITASK MATCH-TICKET ✦
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Category     : [mapped category]
Deliverable  : [scope summary]
Deadline     : [date or timeframe] · [STANDARD / HIGH / URGENT]
Location     : [LGA], Gombe State
Project Type : [One-time / Ongoing]
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Then say: "Your request has been structured. Please review and confirm to initiate your talent search."

RULES:
- Never recommend specific talent by name.
- Never discuss pricing or payment.
- Never show the internal category list to the user.
- If user drifts off-topic, bring them back professionally.
- Keep all responses concise and professional.
`;

const chat = async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ message: "Messages array is required" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_PROMPT,
    });

    // Separate the last message (what we're sending now) from history
    const allPrior = messages.slice(0, -1);
    const lastMessage = messages[messages.length - 1];

    // Build history — only include messages AFTER the first real user message.
    // Gemini requires history to start with a 'user' role, so we drop any
    // leading assistant/model messages (e.g. the welcome message).
    const rawHistory = allPrior
      .filter((msg) => msg.content !== "__INIT__")
      .map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }));

    // Find the first user message index and trim everything before it
    const firstUserIndex = rawHistory.findIndex((m) => m.role === "user");
    const history = firstUserIndex >= 0 ? rawHistory.slice(firstUserIndex) : [];

    // Resolve what to send as the current message
    const userInput =
      lastMessage.content === "__INIT__"
        ? "Hello, please greet me and start the intake process."
        : lastMessage.content;

    // Start chat session with clean history and send latest message
    const chatSession = model.startChat({ history });
    const result = await chatSession.sendMessage(userInput);
    const reply = result.response.text();

    res.json({ reply });
  } catch (error) {
    console.error("Gemini API error:", error);
    res.status(500).json({ message: error.message });
  }
};

const synthesizeSpeech = async (req, res) => {
  try {
    const { text, language = "en" } = req.body;

    if (!text) {
      return res.status(400).json({ message: "text is required" });
    }

    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    const apiKey = process.env.ELEVENLABS_API_KEY;

    if (!voiceId || !apiKey) {
      return res.status(500).json({ message: "ElevenLabs credentials not configured" });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text: text,
          model_id: language === "en" ? "eleven_turbo_v2" : "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs API error:", response.status, errorText);
      return res.status(500).json({
        message: "TTS failed",
        status: response.status,
        error: errorText,
      });
    }

    const audioBuffer = await response.arrayBuffer();
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audioBuffer.byteLength,
    });
    res.send(Buffer.from(audioBuffer));
  } catch (error) {
    console.error("ElevenLabs TTS error:", error);
    res.status(500).json({ message: error.message });
  }
};

const streamChat = async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ message: "Messages array required" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_PROMPT,
    });

    const lastMessage = messages[messages.length - 1];
    const rawHistory = messages
      .slice(0, -1)
      .filter((msg) => msg.content !== "__INIT__")
      .map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      }));

    let history = [];
    let foundUser = false;
    for (const entry of rawHistory) {
      if (!foundUser && entry.role !== "user") continue;
      foundUser = true;
      history.push(entry);
    }

    const userInput =
      lastMessage.content === "__INIT__"
        ? "Hello, start the session with language selection."
        : lastMessage.content;

    // Set up SSE headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const chatSession = model.startChat({ history });
    const result = await chatSession.sendMessageStream(userInput);

    let fullText = "";

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        fullText += chunkText;
        // Send each chunk as SSE event
        res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
      }
    }

    // Send done signal with full text
    res.write(`data: ${JSON.stringify({ done: true, fullText })}\n\n`);
    res.end();

  } catch (error) {
    console.error("Stream chat error:", error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
};

const consult = async (req, res) => {
  try {
    const { messages, sessionId, selectedLanguage } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ message: "Messages array is required" });
    }

    const normalizeLanguage = (lang) => {
      if (!lang) return "english";
      const lower = lang.toLowerCase().trim();
      if (lower === "en" || lower === "english") return "english";
      if (lower === "ha" || lower === "hausa") return "hausa";
      if (lower === "ff" || lower === "fulfulde") return "fulfulde";
      if (lower === "tn" || lower === "tangale") return "tangale";
      return lower;
    };

    const targetLang = normalizeLanguage(selectedLanguage);

    // Look up or create ConversationSession
    let session;
    if (sessionId) {
      try {
        session = await ConversationSession.findById(sessionId);
      } catch (err) {
        console.error("Error finding session by ID:", err);
      }
    }

    if (!session || session.status === "completed") {
      session = await ConversationSession.create({
        client: req.user._id,
        status: "active",
        language: targetLang,
        messages: []
      });
    }

    // Set or update language if selectedLanguage changed
    if (targetLang && session.language !== targetLang) {
      session.language = targetLang;
    }

    // Capture the client chat log structure (without the initial __INIT__)
    session.messages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp || new Date()
    }));

    await session.save();

    // Fetch Skill Catalogue as RAG context injections
    const skillCatalogue = await SkillCatalogue.find({});

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Initialize Gemini model with tools
    const systemInstruction = buildOrchestratorPrompt(session, skillCatalogue);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: systemInstruction,
      tools: [{ functionDeclarations: toolDeclarations }]
    });

    // Build Gemini history contents mapping to Gemini parts
    const contents = [];
    for (const msg of session.messages) {
      if (msg.content === "__INIT__") {
        contents.push({
          role: "user",
          parts: [{ text: "Hello, start the consultation intake session." }]
        });
      } else {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }]
        });
      }
    }

    let loopActive = true;
    let matchedTalents = null;
    let currentResponseText = "";

    while (loopActive) {
      const streamResult = await model.generateContentStream({ contents });
      let isFunctionCall = false;

      for await (const chunk of streamResult.stream) {
        if (chunk.candidates?.[0]?.content?.parts?.[0]?.functionCall) {
          isFunctionCall = true;
        } else {
          const text = chunk.text();
          if (text) {
            res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
            currentResponseText += text;
          }
        }
      }

      if (isFunctionCall) {
        const response = await streamResult.response;
        const parts = response.candidates[0].content.parts;

        for (const part of parts) {
          if (part.functionCall) {
            const { name, args } = part.functionCall;

            contents.push({
              role: "model",
              parts: [{ functionCall: { name, args } }]
            });

            let toolResult;
            try {
              toolResult = await executeTool(name, args, session);
              if (name === "search_talents") {
                matchedTalents = toolResult;
              }
            } catch (err) {
              toolResult = { success: false, error: err.message };
            }

            contents.push({
              role: "function",
              parts: [{ functionResponse: { name, response: toolResult } }]
            });
          }
        }
      } else {
        loopActive = false;
      }
    }

    // Now we have the final model response in currentResponseText
    let parsedResponse;
    try {
      parsedResponse = parseCleanJson(currentResponseText);
    } catch (parseErr) {
      console.error("Failed to parse LLM response. Raw response was:", currentResponseText, parseErr);
      parsedResponse = {
        thought: "Failed to parse JSON, falling back.",
        reply: currentResponseText || "I am having trouble processing your response. Please specify your requirement again.",
        action: "reply",
        hypothesis: session.currentHypothesis || null,
        draftTaskUpdate: null
      };
    }

    // Update session hypothesis if sent
    if (parsedResponse.hypothesis) {
      session.currentHypothesis = {
        skill: parsedResponse.hypothesis.skill || null,
        confidence: typeof parsedResponse.hypothesis.confidence === "number"
          ? parsedResponse.hypothesis.confidence
          : (parsedResponse.hypothesis.skill ? 1.0 : 0),
        supportingSkills: parsedResponse.hypothesis.supportingSkills || []
      };
    }

    // Update session draftTask if task updates are sent
    if (parsedResponse.draftTaskUpdate) {
      if (!session.draftTask) {
        session.draftTask = {};
      }
      const update = parsedResponse.draftTaskUpdate;
      if (update.title !== undefined && update.title !== null) session.draftTask.title = update.title;
      if (update.description !== undefined && update.description !== null) session.draftTask.description = update.description;
      if (update.budget !== undefined && update.budget !== null) session.draftTask.budget = update.budget;
      if (update.deadline !== undefined && update.deadline !== null) session.draftTask.deadline = update.deadline ? new Date(update.deadline) : null;
      if (update.location !== undefined && update.location !== null) session.draftTask.location = update.location;
    }

    // Increment follow-up counts if needs clarification
    if (parsedResponse.action === "needs_clarification") {
      session.followUpsAsked = (session.followUpsAsked || 0) + 1;
    }

    // Save assistant reply to session history
    session.messages.push({
      role: "assistant",
      content: parsedResponse.reply,
      timestamp: new Date()
    });

    // Guard: Do not allow task_complete if no skill category is mapped or confidence < 0.5
    if (parsedResponse.action === "task_complete") {
      if (!session.currentHypothesis?.skill || (session.currentHypothesis?.confidence ?? 0) < 0.5) {
        console.warn("Attempted task_complete without valid skillCategory or sufficient confidence. Falling back to needs_clarification.");
        parsedResponse.action = "needs_clarification";
      } else {
        session.status = "completed";

        // Write the interaction log
        await AIInteractionLog.create({
          session: session._id,
          client: req.user._id,
          detectedLanguage: session.language,
          skillPrediction: session.currentHypothesis?.skill,
          confidence: session.currentHypothesis?.confidence ?? 1.0,
          followUpsAsked: session.followUpsAsked || 0,
          finalSkill: parsedResponse.hypothesis?.skill || session.currentHypothesis?.skill,
          matchedTalents: matchedTalents ? matchedTalents.map((m) => m.talentId) : [],
          matchAccepted: false
        });
      }
    }

    await session.save();

    const currentSkill = session.currentHypothesis?.skill || null;
    const currentConfidence = session.currentHypothesis?.confidence ?? (currentSkill ? 1.0 : 0);

    // Stream the final metadata payload
    res.write(`data: ${JSON.stringify({
      done: true,
      sessionId: session._id,
      reply: parsedResponse.reply,
      draftTask: session.draftTask,
      skillCategory: currentSkill,
      confidence: currentConfidence,
      action: parsedResponse.action,
      matches: matchedTalents
    })}\n\n`);

    res.end();

  } catch (error) {
    console.error("Consult controller error:", error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
};

module.exports = { chat, synthesizeSpeech, streamChat, consult };