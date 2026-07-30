const Notification = require("../models/Notification");

// GET /api/notifications  — current user's notifications (paginated)
const getNotifications = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const filter = { recipient: req.user._id };
        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(Number(limit))
                .populate("taskId", "title category status"),
            Notification.countDocuments(filter),
            Notification.countDocuments({ ...filter, isRead: false }),
        ]);
        res.json({ notifications, total, unreadCount, page: Number(page) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// PATCH /api/notifications/:id/read
const markRead = async (req, res) => {
    try {
        const n = await Notification.findOne({ _id: req.params.id, recipient: req.user._id });
        if (!n) return res.status(404).json({ message: "Notification not found" });
        n.isRead = true;
        await n.save();
        res.json(n);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// PATCH /api/notifications/read-all
const markAllRead = async (req, res) => {
    try {
        await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true });
        res.json({ message: "All notifications marked as read" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET /api/notifications/unread-count
const getUnreadCount = async (req, res) => {
    try {
        const count = await Notification.countDocuments({ recipient: req.user._id, isRead: false });
        res.json({ count });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getNotifications, markRead, markAllRead, getUnreadCount };
