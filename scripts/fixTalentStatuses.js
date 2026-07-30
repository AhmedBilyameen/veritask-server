const mongoose = require("mongoose");
const TalentProfile = require("../models/TalentProfile");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const fix = async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const result = await TalentProfile.updateMany(
        { verificationStatus: "unverified" },
        { $set: { verificationStatus: "pending" } }
    );

    console.log(`Updated ${result.modifiedCount} talent profiles from unverified to pending`);
    await mongoose.disconnect();
};

fix().catch(console.error);
