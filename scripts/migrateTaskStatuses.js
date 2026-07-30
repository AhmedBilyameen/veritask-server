const mongoose = require("mongoose");
const Task = require("../models/Task");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const migrate = async () => {
    await mongoose.connect(process.env.MONGO_URI);

    // Map old statuses to new ones
    const migrations = [
        { from: "matched", to: "pending_acceptance" },
        { from: "open", to: "open" }, // unchanged
        { from: "in_progress", to: "in_progress" }, // unchanged
        { from: "completed", to: "completed" }, // unchanged
        { from: "cancelled", to: "cancelled" }, // unchanged
    ];

    for (const { from, to } of migrations) {
        if (from === to) continue;
        const result = await Task.updateMany(
            { status: from },
            { $set: { status: to } }
        );
        console.log(`Migrated ${result.modifiedCount} tasks from "${from}" to "${to}"`);
    }

    console.log("Migration complete");
    await mongoose.disconnect();
};

migrate().catch(console.error);
