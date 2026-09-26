import type { WorkerOptions } from "bullmq";

// Centralised BullMQ worker polling tuning. Queue NAMES live in
// queue.constants.ts; this file is only about how hard an IDLE worker hits
// Redis, and it exists so the five @Processor sites cannot drift apart.
//
// ─── Why (2026-09-23) ────────────────────────────────────────────────────────
//
// BullMQ's defaults are drainDelay: 5 (seconds) and stalledInterval: 30_000
// (ms) — read from bullmq@5.77.3/dist/cjs/classes/worker.js:34, not assumed.
// An idle worker therefore issues, per minute:
//
//   60/5  bzpopmin      = 12   (the blocking fetch, worker.js:438)
//   60/5  moveToActive  = 12   (the EVALSHA that follows every bzpopmin
//                               timeout — worker.js:371-373)
//   60/30 stalled check =  2   (moveStalledJobsToWait, worker.js:837)
//                        ────
//                          26  commands/minute, with ZERO jobs and ZERO users
//
// The API process runs four of these workers (imports, curriculum, push, ai),
// so the floor is ~104 commands/minute — about 4.6M/month before anyone logs
// in. Upstash bills per command, and it was ~82% of the August Fly bill.
//
// This is also a STABILITY change, not only a cost one. On 2026-09-23, during
// normal operation, production logged an Upstash "Error running script:
// execution timed out" on the imports queue's moveToActive, and 34 minutes
// later "caller gone" on all four queues' bzpopmin in the same second —
// BullMQ's own 6-second watchdog (worker.js:432-434) force-disconnecting every
// blocking connection because Upstash had not answered a 5-second block in
// time. Both failures landed on exactly the two commands this polling
// generates continuously.
//
// ─── Why raising drainDelay does NOT delay job pickup ────────────────────────
//
// This is the load-bearing point, and the reason these numbers are safe.
// A worker does not poll on a timer — it blocks on the queue's MARKER key
// (`bzpopmin(this.keys.marker, blockTimeout)`, worker.js:438). Adding a job
// writes to that marker, which makes the blocked bzpopmin return IMMEDIATELY.
// drainDelay is only the fallback timeout for when nothing arrives, and
// getBlockTimeout() (worker.js:485-489) applies it *only* when there is no
// delayed job pending. So a longer drainDelay costs nothing in latency for
// normally-enqueued work. worker-tuning.spec.ts proves this against a real
// Redis rather than leaving it as an argument.
//
// ─── The one real trade-off: stalled-job recovery is slower ──────────────────
//
// stalledInterval is how often a worker looks for jobs orphaned by a worker
// that died mid-job (crash, OOM, SIGTERM). Raising it does NOT risk losing a
// job — maxStalledCount and each queue's `attempts` are untouched — it only
// delays the re-queue. Worst case per queue is its stalledInterval below.
//
// Values are deliberately per-queue rather than one shared number, because the
// acceptable recovery delay differs:
export const WORKER_TUNING = {
  // A human is watching an import progress page, and the API process does NOT
  // call enableShutdownHooks(), so an in-flight import IS the case most likely
  // to be orphaned by a deploy. Kept tighter than the rest for that reason.
  imports: {
    drainDelay: 60,
    stalledInterval: 180_000,
  },

  // Background ingest + embeddings. Nobody is waiting on a screen.
  curriculum: {
    drainDelay: 60,
    stalledInterval: 300_000,
  },

  // Every retry here is a fresh PAID model call, so a slower re-queue is
  // actively desirable — it makes duplicate generations less likely, not more.
  ai: {
    drainDelay: 60,
    stalledInterval: 300_000,
  },

  // Delayed receipt-poll jobs are woken by their own delay timer, which takes
  // the blockUntil branch of getBlockTimeout() and ignores drainDelay entirely.
  push: {
    drainDelay: 60,
    stalledInterval: 300_000,
  },

  // The most conservative entry, deliberately. This worker runs on the
  // scale-to-zero render machine, whose Fly lifecycle SIGTERMs it between
  // jobs, so orphaning is likeliest here — and a stalled render leaves a
  // report card showing pdfStatus=PENDING to a real user until it is retried.
  reportCards: {
    drainDelay: 30,
    stalledInterval: 120_000,
  },
} as const satisfies Record<string, Pick<WorkerOptions, "drainDelay" | "stalledInterval">>;
