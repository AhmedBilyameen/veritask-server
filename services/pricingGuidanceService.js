/**
 * VeriTask Admin-Configurable Pricing Guidance Service
 * Provides budget guidance ranges based on skill category and complexity.
 * Guidance is non-authoritative — client retains full freedom to choose their budget.
 */

const GUIDANCE_CONFIG = {
    "Graphic Design": {
        simple: { min: 10000, max: 25000 },
        medium: { min: 25000, max: 60000 },
        complex: { min: 60000, max: 150000 },
    },
    "Data Analysis": {
        simple: { min: 20000, max: 50000 },
        medium: { min: 50000, max: 120000 },
        complex: { min: 120000, max: 300000 },
    },
    Cybersecurity: {
        simple: { min: 40000, max: 100000 },
        medium: { min: 100000, max: 250000 },
        complex: { min: 250000, max: 600000 },
    },
    "Web Development": {
        simple: { min: 30000, max: 80000 },
        medium: { min: 80000, max: 200000 },
        complex: { min: 200000, max: 500000 },
    },
    "IT Support & Maintenance": {
        simple: { min: 15000, max: 35000 },
        medium: { min: 35000, max: 80000 },
        complex: { min: 80000, max: 200000 },
    },
    "Device Repair": {
        simple: { min: 10000, max: 25000 },
        medium: { min: 25000, max: 50000 },
        complex: { min: 50000, max: 120000 },
    },
    "Digital Marketing": {
        simple: { min: 20000, max: 45000 },
        medium: { min: 45000, max: 100000 },
        complex: { min: 100000, max: 250000 },
    },
    // New 3MTT tracks configurations
    "Software Development": {
        simple: { min: 35000, max: 90000 },
        medium: { min: 90000, max: 250000 },
        complex: { min: 250000, max: 600000 },
    },
    "UI/UX Design": {
        simple: { min: 20000, max: 50000 },
        medium: { min: 50000, max: 120000 },
        complex: { min: 120000, max: 300000 },
    },
    "Data Analysis & Visualization": {
        simple: { min: 20000, max: 50000 },
        medium: { min: 50000, max: 120000 },
        complex: { min: 120000, max: 300000 },
    },
    "Quality Assurance": {
        simple: { min: 15000, max: 40000 },
        medium: { min: 40000, max: 100000 },
        complex: { min: 100000, max: 250000 },
    },
    "Product Management": {
        simple: { min: 25000, max: 60000 },
        medium: { min: 60000, max: 150000 },
        complex: { min: 150000, max: 350000 },
    },
    "Data Science": {
        simple: { min: 30000, max: 75000 },
        medium: { min: 75000, max: 180000 },
        complex: { min: 180000, max: 450000 },
    },
    "Animation": {
        simple: { min: 15000, max: 40000 },
        medium: { min: 40000, max: 90000 },
        complex: { min: 90000, max: 200000 },
    },
    "AI/Machine Learning": {
        simple: { min: 40000, max: 100000 },
        medium: { min: 100000, max: 250000 },
        complex: { min: 250000, max: 700000 },
    },
    "Game Development": {
        simple: { min: 30000, max: 80000 },
        medium: { min: 80000, max: 200000 },
        complex: { min: 200000, max: 500000 },
    },
    "Cloud Computing": {
        simple: { min: 30000, max: 80000 },
        medium: { min: 80000, max: 200000 },
        complex: { min: 200000, max: 500000 },
    },
    "DevOps": {
        simple: { min: 30000, max: 80000 },
        medium: { min: 80000, max: 200000 },
        complex: { min: 200000, max: 500000 },
    },
    Other: {
        simple: { min: 15000, max: 40000 },
        medium: { min: 40000, max: 90000 },
        complex: { min: 90000, max: 200000 },
    },
};

/**
 * Get pricing guidance range for a category and complexity level
 */
function getPricingRange(category, complexity = "medium") {
    // Try exact match first
    let catConfig = GUIDANCE_CONFIG[category];

    // Mappings of tracks to legacy categories as fallbacks
    if (!catConfig) {
        const fallbacks = {
            "Software Development": "Web Development",
            "UI/UX Design": "Graphic Design",
            "Data Analysis & Visualization": "Data Analysis",
            "Data Science": "Data Analysis",
            "Quality Assurance": "IT Support & Maintenance",
            "Cloud Computing": "Web Development",
            "DevOps": "Web Development",
            "Game Development": "Web Development",
            "AI/Machine Learning": "Cybersecurity",
            "Animation": "Graphic Design",
            "Product Management": "Digital Marketing",
        };
        const mapped = fallbacks[category];
        catConfig = GUIDANCE_CONFIG[mapped] || GUIDANCE_CONFIG["Other"];
    }

    const range = catConfig[complexity] || catConfig["medium"];
    return range;
}

/**
 * Evaluate a proposed budget against guidance ranges
 * Returns state: 'within_range' | 'below_range' | 'above_range' | 'none'
 */
function evaluateBudget(category, amount, complexity = "medium") {
    if (!amount || isNaN(amount) || amount <= 0) {
        return {
            state: "none",
            message: "Please enter a valid project budget in NGN.",
            min: null,
            max: null,
        };
    }

    const range = getPricingRange(category, complexity);
    const numAmount = Number(amount);

    if (numAmount < range.min) {
        return {
            state: "below_range",
            message: `Your budget is below the typical range for this type of project (₦${range.min.toLocaleString()} – ₦${range.max.toLocaleString()}). You can still continue, but you may receive fewer matches or talents may decline.`,
            min: range.min,
            max: range.max,
        };
    } else if (numAmount > range.max) {
        return {
            state: "above_range",
            message: `Your budget is above the typical range for this type of project (₦${range.min.toLocaleString()} – ₦${range.max.toLocaleString()}). A higher budget may help attract more experienced talents.`,
            min: range.min,
            max: range.max,
        };
    } else {
        return {
            state: "within_range",
            message: `Based on the requirements provided, this budget is within the typical range for this type of project.`,
            min: range.min,
            max: range.max,
        };
    }
}

module.exports = {
    GUIDANCE_CONFIG,
    getPricingRange,
    evaluateBudget,
};
