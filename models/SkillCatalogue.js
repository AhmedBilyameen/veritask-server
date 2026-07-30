const mongoose = require("mongoose");

const skillCatalogueSchema = new mongoose.Schema({
    skill: { type: String, required: true, unique: true }, // one of the 12 3MTT tracks
    commonPhrasings: [String],
    relatedSkills: [String],
    typicalDeliverables: [String],
    disambiguationQuestions: [String]
}, { timestamps: true });

module.exports = mongoose.model("SkillCatalogue", skillCatalogueSchema);
