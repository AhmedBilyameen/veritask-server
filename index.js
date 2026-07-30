const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const connectDB = require("./config/db");

dotenv.config();
connectDB();

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const cleanOrigin = origin.trim().replace(/\/$/, "");
    const isAllowed = allowedOrigins.some(
      (allowed) => allowed.trim().replace(/\/$/, "") === cleanOrigin
    );
    if (isAllowed || process.env.NODE_ENV !== "production") {
      return callback(null, true);
    }
    return callback(null, true); // Allow configured origins gracefully
  },
  credentials: true,
}));

app.use(cookieParser());

// ─── Raw body capture for Paystack webhook signature verification ─────────────
// MUST be registered BEFORE express.json() so the webhook receives the raw buffer.
// Only /api/payments/webhook gets the rawBody; all other routes use parsed JSON.
app.use((req, res, next) => {
  if (req.path === "/api/payments/webhook") {
    let rawBody = "";
    req.on("data", (chunk) => { rawBody += chunk; });
    req.on("end", () => {
      req.rawBody = rawBody;
      try { req.body = JSON.parse(rawBody); } catch { req.body = {}; }
      next();
    });
  } else {
    next();
  }
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Request logger — sanitized incoming requests in terminal
app.use((req, res, next) => {
  if (req.body && Object.keys(req.body).length > 0) {
    const sanitized = { ...req.body };
    delete sanitized.password;
    delete sanitized.confirmPassword;
    delete sanitized.token;
    delete sanitized.refreshToken;
    delete sanitized.secret;
    console.log(`${req.method} ${req.path}`, sanitized);
  } else {
    console.log(`${req.method} ${req.path}`);
  }
  next();
});

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/tasks", require("./routes/taskRoutes"));
app.use("/api/ai", require("./routes/aiRoutes"));
app.use("/api/match", require("./routes/matchRoutes"));
app.use("/api/reviews", require("./routes/reviewRoutes"));
app.use("/api/verification", require("./routes/verificationRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/wallet", require("./routes/walletRoutes"));
app.use("/api/payments", require("./routes/paymentRoutes"));
app.use("/api/workspace", require("./routes/workspaceRoutes"));

app.get("/", (req, res) => {
  res.json({ message: "VeritTask API is running", status: "healthy" });
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).json({ message: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`VeritTask server running on port ${PORT} [payment provider: ${require("./services/PaymentService").getProviderName()}]`);
});
