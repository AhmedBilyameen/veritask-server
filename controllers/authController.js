const User = require("../models/User");
const TalentProfile = require("../models/TalentProfile");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const generateAccessToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "15m" });

const generateRefreshToken = (id) =>
  jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: "7d" });

const sendRefreshCookie = (res, token) => {
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie("refreshToken", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
};

const register = async (req, res) => {
  try {
    console.log("Register attempt:", req.body);

    const { name, email, password, phone, role, location } = req.body;

    if (!name || !email || !password || !phone || !role) {
      return res.status(400).json({
        message: "Please fill all required fields",
        received: { name, email, phone, role, hasPassword: !!password },
      });
    }

    const validRoles = ["client", "talent", "admin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        message: `Invalid role. Must be one of: ${validRoles.join(", ")}`,
        received: role,
      });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        message: "An account with this email already exists",
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      phone,
      role,
      location: location || { lga: "", area: "" },
    });

    if (role === "talent") {
      await TalentProfile.create({ user: user._id, verificationStatus: "pending" });
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    user.refreshToken = refreshToken;
    await user.save();

    sendRefreshCookie(res, refreshToken);
    console.log("User created successfully:", user._id);

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      location: user.location,
      isVerified: user.isVerified,
      token: accessToken,
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      message: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    user.refreshToken = refreshToken;
    await user.save();

    sendRefreshCookie(res, refreshToken);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      location: user.location,
      isVerified: user.isVerified,
      isOnboarded: user.isOnboarded,
      displayName: user.displayName,
      profile: user.profile,
      token: accessToken,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------------------------------------------------------------------------
// POST /refresh — no auth required
// ---------------------------------------------------------------------------
const refreshAccessToken = async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ message: "No refresh token" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    const user = await User.findById(decoded.id);
    if (!user || user.refreshToken !== token) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    const newAccessToken = generateAccessToken(user._id);

    res.json({
      token: newAccessToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------------------------------------------------------------------------
// POST /logout — protect middleware required
// ---------------------------------------------------------------------------
const logout = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user) {
      user.refreshToken = null;
      await user.save();
    }
    const isProduction = process.env.NODE_ENV === "production";
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
    });
    res.json({ message: "Logged out" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------------------------------------------------------------------------
// GET /admin/stats  — admin only
// ---------------------------------------------------------------------------
const getAdminStats = async (req, res) => {
  try {
    const [verifiedCount, totalTalents, totalClients] = await Promise.all([
      User.countDocuments({ role: "talent", isVerified: true }),
      User.countDocuments({ role: "talent" }),
      User.countDocuments({ role: "client" }),
    ]);
    res.json({ verifiedCount, totalTalents, totalClients });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ---------------------------------------------------------------------------
// GET /public-stats — no auth required (landing page)
// ---------------------------------------------------------------------------
const getPublicStats = async (req, res) => {
  try {
    const Task = require("../models/Task");
    const [totalTalents, verifiedTalents, totalClients, totalTasks] = await Promise.all([
      User.countDocuments({ role: "talent" }),
      User.countDocuments({ role: "talent", isVerified: true }),
      User.countDocuments({ role: "client" }),
      Task.countDocuments({}),
    ]);
    res.json({ totalTalents, verifiedTalents, totalClients, totalTasks });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { register, login, getMe, getAdminStats, getPublicStats, refreshAccessToken, logout };