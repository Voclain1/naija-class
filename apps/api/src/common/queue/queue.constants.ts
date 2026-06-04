// Queue names. Centralised so producers and consumers can't drift.
//
// Slice 6 registers IMPORTS_QUEUE only (validate job). Slice 7 adds the
// commit job on the same queue. Future audit-BullMQ migration would
// add AUDIT_QUEUE here.
export const IMPORTS_QUEUE = "imports";

// Job names within IMPORTS_QUEUE.
export const IMPORTS_JOB_VALIDATE = "validate";
export const IMPORTS_JOB_COMMIT = "commit";

// Phase 2 / Slice 5 — report-card PDF render queue (Puppeteer). One job per
// card; concurrency 1 (pooled single browser; the memory-budget control).
export const REPORT_CARDS_QUEUE = "report-cards";
export const REPORT_CARDS_JOB_RENDER = "render";
