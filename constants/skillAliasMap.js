/**
 * Bidirectional mapping between legacy 8 categories and new 12 3MTT tracks.
 * Used during talent matching to prevent zero matches for legacy-seeded talent.
 */
const SKILL_ALIAS_MAP = {
    "Graphic Design": ["UI/UX Design", "Animation"],
    "UI/UX Design": ["Graphic Design"],
    "Animation": ["Graphic Design"],

    "Web Development": ["Software Development", "Cloud Computing", "DevOps"],
    "Software Development": ["Web Development"],
    "Cloud Computing": ["Web Development", "DevOps"],
    "DevOps": ["Web Development", "Cloud Computing"],

    "Data Analysis": ["Data Analysis & Visualization", "Data Science"],
    "Data Analysis & Visualization": ["Data Analysis"],
    "Data Science": ["Data Analysis"],

    "Digital Marketing": ["Product Management"],
    "Product Management": ["Digital Marketing"],

    "IT Support & Maintenance": ["Quality Assurance", "Cloud Computing", "DevOps"],
    "Quality Assurance": ["IT Support & Maintenance"],

    "Cybersecurity": ["AI/Machine Learning"],
    "AI/Machine Learning": ["Cybersecurity"],

    "Device Repair": [],
    "Game Development": ["Software Development"],
    "Other": []
};

/**
 * Returns an array of skill name strings including the queried skill and all its aliases.
 * @param {string} skill - The skill/category name to lookup
 * @returns {Array<string>} List of related/aliased skill names
 */
function getAliasedSkills(skill) {
    const aliases = SKILL_ALIAS_MAP[skill] || [];
    return [skill, ...aliases];
}

module.exports = {
    SKILL_ALIAS_MAP,
    getAliasedSkills
};
