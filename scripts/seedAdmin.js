const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const seed = async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const existing = await User.findOne({ email: "admin@veritask.ng" });
    if (existing) {
        console.log("Admin already exists");
        await mongoose.disconnect();
        return;
    }

    const hashed = await bcrypt.hash("Admin@1234", 10);

    await User.create({
        name: "VeritTask Admin",
        email: "admin@veritask.ng",
        password: hashed,
        phone: "08000000000",
        role: "admin",
        location: { lga: "Gombe", area: "GRA" },
        isVerified: true,
    });

    console.log("Admin created: admin@veritask.ng / Admin@1234");
    await mongoose.disconnect();
};

seed().catch(console.error);
