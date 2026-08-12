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

// Phase 5 / Slice 3 — AI generation queue. One job per student comment, not
// one per class: a 40-student arm is 40 short Haiku calls, and batching them
// into a single job would mean one failure loses 39 good generations and one
// job holding a worker for minutes.
//
// Its own queue rather than a job name on REPORT_CARDS_QUEUE, whose processor
// runs at concurrency 1 to hold the Chromium memory budget. AI jobs are
// network-bound and hold no browser, so sharing that queue would serialise
// them behind PDF renders for no reason — and raising the render concurrency
// to compensate would break the memory gate that number exists to protect.
export const AI_QUEUE = "ai";
export const AI_JOB_SUBJECT_COMMENT = "subject-comment";
// Slice 4 — the form teacher's whole-child comment. A second job NAME on the
// same queue, not a second queue and not a second @Processor: @nestjs/bullmq
// spawns one Worker per @Processor class, so a second class here would
// load-balance AI jobs across competing workers. Job-name dispatch is the
// pattern ImportsProcessor already established for one queue carrying several
// job kinds.
export const AI_JOB_FORM_COMMENT = "form-comment";
