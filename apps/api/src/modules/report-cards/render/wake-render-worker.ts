import { Logger } from "@nestjs/common";

// Wakes the school-kit-render-worker Fly machine after render jobs are
// enqueued.
//
// WHY THIS IS NEEDED AT ALL. The render worker runs `min_machines_running = 0`
// (see apps/api/fly-render.toml) — Fly stops it when idle. A stopped machine
// cannot consume the BullMQ queue, so enqueued render jobs sit there
// indefinitely until something starts it. Nothing else does: BullMQ has no
// "wake the consumer" mechanism, and the worker cannot poll while stopped.
// The user-visible symptom is a released report-card batch whose PDFs simply
// never appear, with no error anywhere.
//
// WHY A SHARED HELPER (2026-08-14). This logic previously existed inline in
// exactly one of the TWO paths that enqueue render jobs —
// ReportCardWorkflowService.release() had it, ReportCardService
// .enqueueArmRender() (the manual render/regenerate endpoint) never did. Both
// enqueue through the same enqueueArmRenderInTx(), so both leave jobs that
// need a running consumer. One helper called by both makes it structurally
// hard for a third enqueue path to be added without the wake.
//
// The wake CANNOT live inside enqueueArmRenderInTx() despite that being the
// shared point, because it must happen after the transaction commits: waking
// the worker before commit races it against jobs whose rows aren't visible yet.
// So it stays at the two call sites, after their respective withTenant blocks.
//
// WHY THE PUBLIC HOSTNAME. Verified empirically 2026-08-14 against production
// with both machines stopped: GET https://school-kit-render-worker.fly.dev/health
// returned 200 in 21.0s and both machines transitioned stopped -> started with
// health checks 1/1. The request routes through Fly Proxy, and Fly Proxy is the
// component that performs auto_start_machines.
//
// Two approaches that do NOT work, documented so they aren't retried:
//   - `http://school-kit-render-worker.internal:4001` (the value that had been
//     written down for RENDER_WORKER_URL). `.internal` DNS only publishes
//     RUNNING machines, so while the worker is stopped the name does not
//     resolve at all — and it bypasses Fly Proxy, which is the only thing that
//     can start the machine. It cannot work by construction: it needs the
//     machine running in order to start it.
//   - `http://` against this app. `force_https = true` means Fly Proxy answers
//     with a 301 itself; whether that still triggers auto_start is undocumented
//     and untested. Using https:// avoids the question entirely.
//
// FIRE-AND-FORGET, deliberately. A failed wake must never fail the release or
// the render request: the jobs are already committed to the queue, and a later
// deploy or a subsequent wake will drain them. Errors are logged at warn, not
// thrown — silence here was part of what let this go unnoticed.

const logger = new Logger("WakeRenderWorker");

// Long enough to cover a genuine cold start (~15-25s for Chrome init, measured
// 21.0s in production) without hanging a request thread indefinitely if the
// worker app is unreachable. Nothing awaits this, so the timeout only bounds
// the background fetch.
const WAKE_TIMEOUT_MS = 30_000;

export function wakeRenderWorker(context: string): void {
  const baseUrl = process.env.RENDER_WORKER_URL;
  if (!baseUrl) {
    // Not configured is a REAL problem in production, not a benign no-op — it
    // means every render batch from here on will queue and never be consumed.
    // It is legitimate in dev and in tests (where the worker runs in-process
    // or not at all), which is why this warns rather than throws.
    logger.warn(
      `RENDER_WORKER_URL is not set — render jobs enqueued by ${context} will not wake the worker. ` +
        `If this is production, PDFs will stay PENDING until the machine is started by something else.`,
    );
    return;
  }

  void fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(WAKE_TIMEOUT_MS) })
    .then((res) => {
      if (!res.ok) {
        logger.warn(`Render worker wake (${context}) returned HTTP ${res.status}.`);
      }
    })
    .catch((err: unknown) => {
      logger.warn(
        `Render worker wake (${context}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}
