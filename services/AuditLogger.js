const AuditLog = require("../models/AuditLog");

/**
 * AuditLogger Service — helper for recording audit events
 */
const AuditLogger = {
    async log({ actorId, actorRole = "system", action, resourceType, resourceId, amount = 0, reference = null, previousState = null, newState = null, ipAddress = null, metadata = {} }) {
        try {
            await AuditLog.create({
                actorId,
                actorRole,
                action,
                resourceType,
                resourceId: String(resourceId),
                amount,
                reference,
                previousState,
                newState,
                ipAddress,
                metadata,
            });
        } catch (err) {
            console.error("[AuditLogger] Failed to record audit log:", err.message);
        }
    },
};

module.exports = AuditLogger;
