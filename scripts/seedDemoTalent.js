const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const TalentProfile = require("../models/TalentProfile");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const talentsData = [
    {
        email: "talent@veritask.ng",
        name: "Aisha Mahmoud",
        phone: "08011111111",
        location: { lga: "Gombe", area: "Pantami" },
        skills: ["UI/UX Design"],
        bio: "Creative UI/UX designer with 3 years experience in brand identity, wireframing, high-fidelity prototypes in Figma, and web interface design. 3MTT fellow, Gombe State cohort.",
        portfolioUrl: "https://behance.net/aishadesigns",
        verificationStatus: "verified",
        rank: "Skilled",
        starRating: 4.8,
        reliabilityFactor: 0.95,
        totalTasksCompleted: 12,
        totalTasksOnTime: 11
    },
    {
        email: "ibrahim@veritask.ng",
        name: "Ibrahim Gombe",
        phone: "08022222222",
        location: { lga: "Akko", area: "Kumo" },
        skills: ["Software Development"],
        bio: "Fullstack web developer specializing in Next.js, modern React, Express.js, and Node.js. Passionate about building robust local business portals. 3MTT fellow.",
        portfolioUrl: "https://github.com/ibrahimgombe",
        verificationStatus: "verified",
        rank: "Pro",
        starRating: 4.9,
        reliabilityFactor: 0.98,
        totalTasksCompleted: 24,
        totalTasksOnTime: 23
    },
    {
        email: "fatima@veritask.ng",
        name: "Fatima Yusuf",
        phone: "08033333333",
        location: { lga: "Gombe", area: "Federal Low Cost" },
        skills: ["Data Analysis & Visualization"],
        bio: "Experienced data analyst skilled in Excel macros, SQL databases, Power BI, and data cleaning. Experienced in providing business operation insights to retail stores.",
        portfolioUrl: "https://linkedin.com/in/fatimadata",
        verificationStatus: "verified",
        rank: "Skilled",
        starRating: 4.7,
        reliabilityFactor: 0.92,
        totalTasksCompleted: 8,
        totalTasksOnTime: 8
    },
    {
        email: "abubakar@veritask.ng",
        name: "Abubakar Sadiq",
        phone: "08044444444",
        location: { lga: "Balanga", area: "Talasse" },
        skills: ["Cybersecurity"],
        bio: "Security analyst specialized in penetration testing, security auditing, and web app firewall configurations. Committed to securing Gombe e-commerce integrations.",
        portfolioUrl: "https://github.com/abubakarsecdoc",
        verificationStatus: "verified",
        rank: "Senior",
        starRating: 5.0,
        reliabilityFactor: 1.0,
        totalTasksCompleted: 15,
        totalTasksOnTime: 15
    }
];

const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to MongoDB for Talent Seeding...");

        // Clean existing users with role 'talent' and their profiles
        const talentUsers = await User.find({ role: "talent" });
        const talentUserIds = talentUsers.map(u => u._id);

        await TalentProfile.deleteMany({ user: { $in: talentUserIds } });
        await User.deleteMany({ role: "talent" });
        console.log("Cleared existing demo talent users and profiles.");

        const defaultHashed = await bcrypt.hash("Talent@1234", 10);
        const ibrahimHashed = await bcrypt.hash("ibrahim123", 10);

        for (const data of talentsData) {
            const userPassword = data.email === "ibrahim@veritask.ng" ? ibrahimHashed : defaultHashed;
            const user = await User.create({
                name: data.name,
                email: data.email,
                password: userPassword,
                phone: data.phone,
                role: "talent",
                location: data.location,
                isVerified: true
            });

            const profile = await TalentProfile.create({
                user: user._id,
                skills: data.skills,
                bio: data.bio,
                portfolioUrl: data.portfolioUrl,
                verificationStatus: data.verificationStatus,
                rank: data.rank,
                starRating: data.starRating,
                reliabilityFactor: data.reliabilityFactor,
                totalTasksCompleted: data.totalTasksCompleted,
                totalTasksOnTime: data.totalTasksOnTime,
                isAvailable: true
            });

            profile.calculateTrustScore();
            await profile.save();

            console.log(`Demo talent created: ${data.email} (${data.name}) - Skills: ${data.skills.join(", ")}`);
        }

        await mongoose.disconnect();
        console.log("Seed talents complete.");
    } catch (error) {
        console.error("Error during talent seeding:", error);
        process.exit(1);
    }
};

seed().catch(console.error);
