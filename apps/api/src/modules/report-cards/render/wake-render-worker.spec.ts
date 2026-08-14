import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wakeRenderWorker } from "./wake-render-worker";

// The render worker runs min_machines_running = 0. A stopped machine cannot
// consume the BullMQ queue, so an enqueue without a wake leaves PDFs PENDING
// forever with no error anywhere — which is exactly what production did from
// the feature shipping until 2026-08-14, because RENDER_WORKER_URL was never
// set on the deployed API.
//
// These tests pin the two properties that failure had:
//   1. an unset URL must be LOUD, not a silent no-op;
//   2. the wake must never throw into the caller — the jobs are already
//      committed, and failing the release over a failed wake is worse.
describe("wakeRenderWorker", () => {
  const original = process.env.RENDER_WORKER_URL;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.RENDER_WORKER_URL;
    else process.env.RENDER_WORKER_URL = original;
  });

  it("calls <url>/health when RENDER_WORKER_URL is set", () => {
    process.env.RENDER_WORKER_URL = "https://school-kit-render-worker.fly.dev";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    wakeRenderWorker("test");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://school-kit-render-worker.fly.dev/health",
    );
  });

  it("does NOT call fetch when RENDER_WORKER_URL is unset — and says so", () => {
    delete process.env.RENDER_WORKER_URL;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // The regression this guards: the old inline `if (renderWorkerUrl) {}` was
    // an unconditional silent skip. Unset is now a warn, so an operator reading
    // logs after a release sees why nothing rendered.
    expect(() => wakeRenderWorker("test")).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never throws into the caller when the wake request rejects", async () => {
    process.env.RENDER_WORKER_URL = "https://school-kit-render-worker.fly.dev";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    expect(() => wakeRenderWorker("test")).not.toThrow();
    // Let the rejected promise settle so an unhandled rejection would surface.
    await new Promise((r) => setTimeout(r, 10));
  });

  it("never throws into the caller on a non-2xx response", async () => {
    process.env.RENDER_WORKER_URL = "https://school-kit-render-worker.fly.dev";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    expect(() => wakeRenderWorker("test")).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});
