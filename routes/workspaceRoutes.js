const express = require("express");
const router = express.Router();
const multer = require("multer");
const { protect } = require("../middleware/authMiddleware");
const {
    getWorkspaceData,
    uploadDeliverableFile,
    submitWork,
    requestRevision,
    approveWork,
} = require("../controllers/workspaceController");

// Memory storage for multer: files kept in RAM buffer for direct Cloudinary stream upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

router.get("/projects/:taskId", protect, getWorkspaceData);
router.post("/projects/:taskId/upload", protect, upload.single("file"), uploadDeliverableFile);
router.post("/projects/:taskId/submit", protect, submitWork);
router.post("/projects/:taskId/request-revision", protect, requestRevision);
router.post("/projects/:taskId/approve", protect, approveWork);

module.exports = router;
