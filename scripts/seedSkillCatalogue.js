const mongoose = require("mongoose");
const SkillCatalogue = require("../models/SkillCatalogue");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const tracks = [
    {
        skill: "Software Development",
        commonPhrasings: [
            "I need a website for my provision shop in Gombe",
            "I want to build a mobile app for customer ordering",
            "developer for pharmacy inventory software",
            "build a school management portal",
            "web developer to build hotel booking web page"
        ],
        relatedSkills: ["UI/UX Design", "Cloud Computing", "DevOps", "Database Management"],
        typicalDeliverables: [
            "Responsive React/Next.js frontend website",
            "Node.js/Express REST API backend",
            "Mobile application package (APK)",
            "Database schema and integration report"
        ],
        disambiguationQuestions: [
            "Do you need a public website that customers visit, or a secure internal portal/software for your staff?",
            "Would you like this to be accessible on mobile phones as an app, or just via web browsers?"
        ]
    },
    {
        skill: "UI/UX Design",
        commonPhrasings: [
            "design how my app will look",
            "graphics drawer for website page layout",
            "design mobile application screens",
            "logo and brand color design for business website",
            "draw website mockup before building it"
        ],
        relatedSkills: ["Software Development", "Animation", "Product Management"],
        typicalDeliverables: [
            "Figma interactive high-fidelity prototype",
            "Wireframes and user flow diagrams",
            "Logo and branding style guide",
            "Exported UI asset pack (SVG, PNG)"
        ],
        disambiguationQuestions: [
            "Do you already have a logo and brand colors determined, or do we need to design those from scratch?",
            "Are we designing/drawing the layout prototype screens, or are you looking for a programmer to write the code?"
        ]
    },
    {
        skill: "Data Analysis & Visualization",
        commonPhrasings: [
            "help arrange my sales record in Excel",
            "draw dashboard for pharmacy monthly report",
            "visualize hospital patient statistics",
            "analyze agricultural feed costs and yield data",
            "make Power BI charts for business sales"
        ],
        relatedSkills: ["Data Science", "Product Management", "Database Management"],
        typicalDeliverables: [
            "Cleaned data spreadsheet (XLSX, CSV)",
            "Interactive Power BI / Tableau dashboard",
            "Monthly sales/operations performance report (PDF)",
            "Charts and visualization templates"
        ],
        disambiguationQuestions: [
            "Where is your data currently stored? (e.g. paper records, Excel, or database?)",
            "Do you need a one-off report analysis, or an automated live-updating dashboard?"
        ]
    },
    {
        skill: "Quality Assurance",
        commonPhrasings: [
            "test my application for bugs and errors",
            "website checker to see if payments are failing",
            "check if the school portal is working fine on all phones",
            "find software bugs before launch"
        ],
        relatedSkills: ["Software Development", "DevOps", "Cybersecurity"],
        typicalDeliverables: [
            "Test execution bug report and logs",
            "Automated test script suite code",
            "User testing feedback and verification list",
            "Performance and load test summary"
        ],
        disambiguationQuestions: [
            "Should we test this manually or do we need automated testing scripts written?",
            "Is the app currently live to customers, or is it still in development?"
        ]
    },
    {
        skill: "Product Management",
        commonPhrasings: [
            "help direct my mobile app developers",
            "write requirements and plan project launch for app",
            "business analyst to coordinate software build",
            "plan new feature roadmap for business website"
        ],
        relatedSkills: ["UI/UX Design", "Software Development", "Data Analysis & Visualization"],
        typicalDeliverables: [
            "Product Requirements Document (PRD)",
            "Feature roadmap and timeline gantt chart",
            "Jira/Trello board setup and backlog",
            "User research and MVP scope plan"
        ],
        disambiguationQuestions: [
            "Are you looking for someone to manage the development process/team, or someone to write the code itself?",
            "Do you already have developers and designers hired, or do we need to source them?"
        ]
    },
    {
        skill: "Data Science",
        commonPhrasings: [
            "model to predict future customer buying habits",
            "analyze big dataset to find patterns",
            "sales prediction tool using past year data",
            "cluster customer types for marketing target"
        ],
        relatedSkills: ["Data Analysis & Visualization", "AI/Machine Learning", "Database Management"],
        typicalDeliverables: [
            "Predictive model file (Python/Pickle)",
            "Clustering analysis report",
            "Jupyter Notebook source code",
            "Data pipeline integration script"
        ],
        disambiguationQuestions: [
            "Do you need simple charts and summaries (Data Analysis) or predictive modeling / machine learning algorithms (Data Science)?",
            "Is the dataset already cleaned and structured, or does it require significant preparation?"
        ]
    },
    {
        skill: "Animation",
        commonPhrasings: [
            "design motion graphics video for my shop billboard",
            "cartoon advertisement for social media Gombe",
            "short 2D video promoting new business",
            "animated intro for youtube channel and logo"
        ],
        relatedSkills: ["UI/UX Design", "Digital Marketing"],
        typicalDeliverables: [
            "High definition promo video (MP4)",
            "Storyboards and character designs",
            "Raw project source files (After Effects, Blender)",
            "Animated GIF / Lottie files for web"
        ],
        disambiguationQuestions: [
            "Do you need 2D vector animation style, 3D animation, or whiteboard hand-drawn explainer style?",
            "Do you already have a voiceover audio/script ready, or do we need to draft the script too?"
        ]
    },
    {
        skill: "AI/Machine Learning",
        commonPhrasings: [
            "integrate chatbot on my business website",
            "auto-reply system using Gemini api AI",
            "photo scanner to auto-classify products",
            "voice recognition command translator"
        ],
        relatedSkills: ["Software Development", "Data Science", "Cloud Computing"],
        typicalDeliverables: [
            "AI API Integration layer code (Node/Python)",
            "Trained model checkpoint files",
            "Prompt engineering parameters sheet",
            "Chatbot conversation flow configuration"
        ],
        disambiguationQuestions: [
            "Are we integrating ready-made AI APIs (e.g. Gemini, OpenAI) or training/fine-tuning a custom machine learning model?",
            "What platform will the AI system run on? (e.g. web, WhatsApp, or mobile app?)"
        ]
    },
    {
        skill: "Cybersecurity",
        commonPhrasings: [
            "secure my company network from hackers",
            "check website for security holes and leaks",
            "help recover hacked business social media page",
            "setup firewalls and secure admin logins for portal"
        ],
        relatedSkills: ["Cloud Computing", "DevOps", "Software Development"],
        typicalDeliverables: [
            "Vulnerability assessment and pentest report",
            "Security compliance action plan",
            "Configured secure firewall and SSL",
            "Incident response check list"
        ],
        disambiguationQuestions: [
            "Do you need security testing on an existing app (Penetration Testing) or setup of secure networks/servers?",
            "Are you currently experiencing an active security breach/attack?"
        ]
    },
    {
        skill: "Game Development",
        commonPhrasings: [
            "build mobile games like Ludo or simple puzzle",
            "Unity programmer for Gombe school games",
            "Android video game for children learning Hausa",
            "2D game build in HTML5 for website"
        ],
        relatedSkills: ["Software Development", "UI/UX Design", "Animation"],
        typicalDeliverables: [
            "Playable Android Game Build (APK)",
            "WebGL folder for web browser play",
            "Unity or Godot project source repository",
            "Game design document containing mechanics"
        ],
        disambiguationQuestions: [
            "Is this game intended for Android phones, iPhones, web browsers, or PCs?",
            "Do you have the game graphics and sounds ready, or should the developer create/source them?"
        ]
    },
    {
        skill: "Cloud Computing",
        commonPhrasings: [
            "move my office databases to AWS amazon online",
            "set up cloud servers to host our website",
            "setup secure database backup on Google Cloud",
            "hosting config for high traffic business portal"
        ],
        relatedSkills: ["DevOps", "Software Development", "Cybersecurity"],
        typicalDeliverables: [
            "Configured cloud infrastructure (AWS/GCP/Azure console setup)",
            "Infrastructure-as-Code scripts",
            "Cloud backup policies configuration",
            "Cost optimization report"
        ],
        disambiguationQuestions: [
            "Which cloud provider do you prefer? (e.g. AWS, DigitalOcean, Heroku or Google Cloud?)",
            "Do you have a current server setup you are migrating from, or is this a fresh installation?"
        ]
    },
    {
        skill: "DevOps",
        commonPhrasings: [
            "setup automatic code deployment pipeline",
            "Dockerize my web apps for easy deploy",
            "configure CI CD Github actions workflow",
            "setup server monitoring systems and alerts"
        ],
        relatedSkills: ["Cloud Computing", "Software Development", "Cybersecurity"],
        typicalDeliverables: [
            "Dockerfile and docker-compose configurations",
            "GitHub Actions workflow scripts (YAML)",
            "Prometheus/Grafana monitoring dashboard",
            "Deployment playbook documentation"
        ],
        disambiguationQuestions: [
            "What programming languages/frameworks are used in your application?",
            "Are you deploying onto local servers, VM VPS instances, or Kubernetes clusters?"
        ]
    }
];

const seed = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected to MongoDB for SkillCatalogue seeding...");

        // Clear existing
        await SkillCatalogue.deleteMany({});
        console.log("Cleared existing SkillCatalogue entries.");

        // Insert new
        await SkillCatalogue.insertMany(tracks);
        console.log(`Successfully seeded ${tracks.length} SkillCatalogue entries.`);

        await mongoose.disconnect();
        console.log("Disconnected from MongoDB.");
    } catch (error) {
        console.error("Error during SkillCatalogue seeding:", error);
        process.exit(1);
    }
};

seed();
