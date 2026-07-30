const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const seed = async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const existing = await User.findOne({ email: "business@veritask.ng" });
    if (existing) {
        console.log("Demo business owner already exists");
        await mongoose.disconnect();
        return;
    }

    const hashed = await bcrypt.hash("Business@1234", 10);

    await User.create({
        name: "Musa Enterprises",
        email: "business@veritask.ng",
        password: hashed,
        phone: "08022222222",
        role: "client",
        location: { lga: "Gombe", area: "Tudun Wada" },
        isVerified: true,
    });

    console.log("Demo business created: business@veritask.ng / Business@1234");
    await mongoose.disconnect();
};

seed().catch(console.error);
