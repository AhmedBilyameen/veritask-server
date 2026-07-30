const SkillCatalogue = require("../models/SkillCatalogue");
const TalentProfile = require("../models/TalentProfile");
const User = require("../models/User");
const { getAliasedSkills } = require("../constants/skillAliasMap");
const pricingGuidanceService = require("./pricingGuidanceService");

// ----------------------------------------------------
// Tool Declarations for Gemini Function Calling
// ----------------------------------------------------
const toolDeclarations = [
    {
        name: "get_skill_catalogue",
        description: "Retrieve the full list of 3MTT tracks with their common phrasings, related skills, deliverables, and typical questions.",
        parameters: { type: "OBJECT", properties: {} }
    },
    {
        name: "search_talents",
        description: "Search for available tech talents in Gombe State based on the skill category (such as Software Development) and optional Gombe LGA.",
        parameters: {
            type: "OBJECT",
            properties: {
                skill: { type: "STRING", description: "The skill track to search for (one of the 12 3MTT tracks)" },
                location: { type: "STRING", description: "Optional Gombe State LGA name (e.g. Akko, Gombe, Federal Low Cost)" }
            },
            required: ["skill"]
        }
    },
    {
        name: "get_talent_profile",
        description: "Retrieve the detailed profile (bio, trust score, rating, completed tasks) of a specific talent by their User/Talent ID.",
        parameters: {
            type: "OBJECT",
            properties: {
                talentId: { type: "STRING", description: "The unique User/Talent ID of the talent" }
            },
            required: ["talentId"]
        }
    },
    {
        name: "create_task_draft",
        description: "Create a new draft task record with draft fields in the active conversation session.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "Short, descriptive title for the task (at least 5 characters)" },
                description: { type: "STRING", description: "Detailed task description and requirements (at least 15 characters)" },
                budget: {
                    type: "OBJECT",
                    properties: {
                        min: { type: "NUMBER", description: "Minimum budget amount in NGN" },
                        max: { type: "NUMBER", description: "Maximum budget amount in NGN" }
                    },
                    required: ["min", "max"]
                },
                deadline: { type: "STRING", description: "Expected task deadline in YYYY-MM-DD format" },
                location: { type: "STRING", description: "One of the valid Gombe State LGAs" }
            },
            required: ["title", "description"]
        }
    },
    {
        name: "update_task_draft",
        description: "Update specific field values in the current task draft in the active session.",
        parameters: {
            type: "OBJECT",
            properties: {
                title: { type: "STRING", description: "Updated task title" },
                description: { type: "STRING", description: "Updated task description" },
                budget: {
                    type: "OBJECT",
                    properties: {
                        min: { type: "NUMBER", description: "Updated minimum budget amount" },
                        max: { type: "NUMBER", description: "Updated maximum budget amount" }
                    }
                },
                deadline: { type: "STRING", description: "Updated deadline in YYYY-MM-DD format" },
                location: { type: "STRING", description: "Updated Gombe State LGA" }
            }
        }
    },
    {
        name: "validate_task",
        description: "Validate the current state of a task draft and check budget viability against pricing guidance services.",
        parameters: {
            type: "OBJECT",
            properties: {
                draftTask: {
                    type: "OBJECT",
                    properties: {
                        title: { type: "STRING" },
                        description: { type: "STRING" },
                        budget: {
                            type: "OBJECT",
                            properties: {
                                min: { type: "NUMBER" },
                                max: { type: "NUMBER" }
                            }
                        },
                        deadline: { type: "STRING" },
                        location: { type: "STRING" }
                    },
                    required: ["title", "description"]
                },
                skill: { type: "STRING", description: "The hypothesized 3MTT track to check pricing against" }
            },
            required: ["draftTask", "skill"]
        }
    }
];

// ----------------------------------------------------
// Tool Handler Implementations
// ----------------------------------------------------

/**
 * Executes a tool call matching the schema declaration.
 * 
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} args - Arguments passed from LLM function-call request
 * @param {Object} session - Active ConversationSession document
 * @returns {Promise<any>} Response block structure
 */
async function executeTool(toolName, args, session) {
    // Enforce the rate limit guard of 15 tools per session
    session.toolCallCount = (session.toolCallCount || 0) + 1;
    if (session.toolCallCount > 15) {
        throw new Error("Max tool-call limit (15) reached for this conversation session to protect against infinite loops.");
    }
    await session.save();

    switch (toolName) {
        case "get_skill_catalogue":
            return await handleGetSkillCatalogue();

        case "search_talents":
            return await handleSearchTalents(args.skill, args.location);

        case "get_talent_profile":
            return await handleGetTalentProfile(args.talentId);

        case "create_task_draft":
            return await handleCreateTaskDraft(args, session);

        case "update_task_draft":
            return await handleUpdateTaskDraft(args, session);

        case "validate_task":
            return await handleValidateTask(args.draftTask, args.skill);

        default:
            throw new Error(`Unknown tool name: ${toolName}`);
    }
}

/**
 * Returns full active catalog from database
 */
async function handleGetSkillCatalogue() {
    const catalogue = await SkillCatalogue.find({});
    return catalogue.map((item) => ({
        skill: item.skill,
        commonPhrasings: item.commonPhrasings,
        relatedSkills: item.relatedSkills,
        typicalDeliverables: item.typicalDeliverables,
        disambiguationQuestions: item.disambiguationQuestions
    }));
}

/**
 * Searches for verified, available talents mapped by skill (supports aliased skills) and optional LGA.
 */
async function handleSearchTalents(skill, location) {
    const aliasedSkills = getAliasedSkills(skill);

    const query = {
        verificationStatus: "verified",
        isAvailable: true,
        skills: { $in: aliasedSkills }
    };

    const profiles = await TalentProfile.find(query).populate("user");

    let results = profiles;

    if (location) {
        const locLower = location.toLowerCase();
        results = profiles.filter((profile) => {
            if (!profile.user || !profile.user.location) return false;
            const userLga = profile.user.location.lga || "";
            const userArea = profile.user.location.area || "";
            return userLga.toLowerCase() === locLower || userArea.toLowerCase() === locLower;
        });
    }

    return results.map((profile) => ({
        talentId: profile.user?._id || profile._id,
        name: profile.user?.name || "Anonymous Talent",
        skills: profile.skills,
        location: profile.user?.location || {},
        trustScore: profile.trustScore || 0,
        starRating: profile.starRating || 0,
        reliabilityFactor: profile.reliabilityFactor || 0
    }));
}

/**
 * Retrieves full talent bio and statistics
 */
async function handleGetTalentProfile(talentId) {
    const profile = await TalentProfile.findOne({ user: talentId }).populate("user");
    if (!profile) {
        // If not found by user relation (User ID), try finding directly by profile ID
        const directProfile = await TalentProfile.findById(talentId).populate("user");
        if (!directProfile) {
            return { success: false, error: "Talent profile not found" };
        }
        return mapProfileToResponse(directProfile);
    }
    return mapProfileToResponse(profile);
}

function mapProfileToResponse(profile) {
    return {
        success: true,
        talentId: profile.user?._id || profile._id,
        name: profile.user?.name || "Anonymous",
        skills: profile.skills,
        bio: profile.bio || "",
        trustScore: profile.trustScore || 0,
        starRating: profile.starRating || 0,
        reliabilityFactor: profile.reliabilityFactor || 0,
        totalTasksCompleted: profile.totalTasksCompleted || 0
    };
}

/**
 * Create a new task draft in the session
 */
async function handleCreateTaskDraft(args, session) {
    session.draftTask = {
        title: args.title,
        description: args.description,
        budget: args.budget || null,
        deadline: args.deadline ? new Date(args.deadline) : null,
        location: args.location || null
    };
    await session.save();
    return { success: true, draftTask: session.draftTask };
}

/**
 * Updates an existing task draft in the active session
 */
async function handleUpdateTaskDraft(args, session) {
    if (!session.draftTask) {
        session.draftTask = {};
    }

    if (args.title !== undefined) session.draftTask.title = args.title;
    if (args.description !== undefined) session.draftTask.description = args.description;
    if (args.budget !== undefined) session.draftTask.budget = args.budget;
    if (args.deadline !== undefined) session.draftTask.deadline = args.deadline ? new Date(args.deadline) : null;
    if (args.location !== undefined) session.draftTask.location = args.location;

    await session.save();
    return { success: true, draftTask: session.draftTask };
}

/**
 * Validates a task draft against requirements and calls pricing guidance
 */
async function handleValidateTask(draftTask, skill) {
    const errors = [];

    if (!draftTask.title || draftTask.title.trim().length < 5) {
        errors.push("Task title must be at least 5 characters long.");
    }

    if (!draftTask.description || draftTask.description.trim().length < 15) {
        errors.push("Task description must be at least 15 characters long.");
    }

    const validLgas = [
        "akko", "balanga", "billiri", "dukku", "funakaye",
        "gombe", "kaltungo", "kwami", "nafada", "shongom", "yamaltu/deba"
    ];
    if (draftTask.location && !validLgas.includes(draftTask.location.toLowerCase().trim())) {
        errors.push(`Location '${draftTask.location}' is not a valid Gombe State LGA.`);
    }

    // Budget validation using pricingGuidanceService
    let budgetValidation = null;
    if (draftTask.budget && (draftTask.budget.min || draftTask.budget.max)) {
        // We average or evaluate based on max budget
        const targetAmount = draftTask.budget.max || draftTask.budget.min;
        // Complexity assumed medium for evaluation here
        const pricingGuidance = pricingGuidanceService.evaluateBudget(skill, targetAmount, "medium");
        budgetValidation = {
            state: pricingGuidance.state,
            message: pricingGuidance.message,
            min: pricingGuidance.min,
            max: pricingGuidance.max
        };
    } else {
        // Fetch typical range for empty budget
        const range = pricingGuidanceService.getPricingRange(skill, "medium");
        budgetValidation = {
            state: "none",
            message: `Typical medium complexity range: ₦${range.min.toLocaleString()} - ₦${range.max.toLocaleString()}`,
            min: range.min,
            max: range.max
        };
    }

    return {
        valid: errors.length === 0,
        errors,
        budgetGuidance: budgetValidation
    };
}

module.exports = {
    toolDeclarations,
    executeTool
};
