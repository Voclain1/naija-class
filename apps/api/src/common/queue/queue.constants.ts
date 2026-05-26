// Queue names. Centralised so producers and consumers can't drift.
//
// Slice 6 registers IMPORTS_QUEUE only (validate job). Slice 7 adds the
// commit job on the same queue. Future audit-BullMQ migration would
// add AUDIT_QUEUE here.
export const IMPORTS_QUEUE = "imports";

// Job names within IMPORTS_QUEUE.
export const IMPORTS_JOB_VALIDATE = "validate";
// commit job lands in slice 7
