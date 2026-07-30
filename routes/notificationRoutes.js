const express = require("express");
const router = express.Router();
const { getNotifications, markRead, markAllRead, getUnreadCount } = require("../controllers/notificationController");
const { protect } = require("../middleware/authMiddleware");

router.get("/", protect, getNotifications);
router.get("/unread-count", protect, getUnreadCount);
router.patch("/read-all", protect, markAllRead);
router.patch("/:id/read", protect, markRead);

module.exports = router;
