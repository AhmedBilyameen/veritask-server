/**
 * PaymentStateMachine — VeriTask Production Payment Lifecycle Guard
 *
 * Centralizes allowed payment status transitions to eliminate hardcoded
 * string assignments scattered across controllers and webhooks.
 *
 * Supported Lifecycles:
 *   - Normal Escrow: initialized -> pending -> authorized -> verified -> escrow_funded -> released -> completed
 *   - Failure: initialized / pending -> failed
 *   - Expiration: initialized -> expired
 *   - Refund: completed / escrow_funded -> refund_requested -> refund_processing -> refunded
 */

class InvalidStateTransitionError extends Error {
    constructor(fromState, toState, entityId = "") {
        super(`Illegal payment state transition from '${fromState}' to '${toState}' for entity [${entityId}]`);
        this.name = "InvalidStateTransitionError";
        this.fromState = fromState;
        this.toState = toState;
    }
}

const ALLOWED_TRANSITIONS = {
    initialized: ["pending", "failed", "expired", "cancelled"],
    pending: ["authorized", "verified", "escrow_funded", "failed", "cancelled"],
    authorized: ["verified", "escrow_funded", "failed"],
    verified: ["escrow_funded", "failed"],
    escrow_funded: ["released", "completed", "refund_requested", "failed"],
    released: ["completed", "refund_requested"],
    completed: ["refund_requested"],
    refund_requested: ["refund_processing", "failed"],
    refund_processing: ["refunded", "failed"],
    failed: [], // Terminal state
    expired: [], // Terminal state
    cancelled: [], // Terminal state
    refunded: [], // Terminal state
};

const PaymentStateMachine = {
    /**
     * Check if a transition from `fromState` to `toState` is valid.
     * @param {string} fromState
     * @param {string} toState
     * @returns {boolean}
     */
    canTransition(fromState, toState) {
        if (fromState === toState) return true; // Idempotent no-op
        const allowed = ALLOWED_TRANSITIONS[fromState] || [];
        return allowed.includes(toState);
    },

    /**
     * Enforce state transition on a Mongoose payment or payment intent document.
     * Throws InvalidStateTransitionError if transition is prohibited.
     *
     * @param {object} doc - Mongoose document with `.status` and `_id`
     * @param {string} nextState - Target status
     * @returns {object} updated doc
     */
    transition(doc, nextState) {
        const currentState = doc.status || "initialized";
        if (currentState === nextState) return doc;

        if (!this.canTransition(currentState, nextState)) {
            throw new InvalidStateTransitionError(currentState, nextState, doc._id || doc.intentId);
        }

        doc.status = nextState;
        return doc;
    },

    InvalidStateTransitionError,
};

module.exports = PaymentStateMachine;
