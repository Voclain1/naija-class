import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";

import { WORKER_TUNING } from "./worker-tuning.js";

// O-3 (2026-09-23) — proves the raised drainDelay / stalledInterval values in
// worker-tuning.ts are safe, against a REAL Redis rather than by argument.
//
// Three things are pinned here:
//   1. MARKER WAKE-UP — a job enqueued while a worker is blocked on a 60s
//      drainDelay is still picked up in well under a second. This is the whole
//      safety case for the change; if it fails, the values must not ship.
//   2. STALLED RECOVERY — a job orphaned by a worker that died mid-process is
//      still re-queued and re-run, just later.
//   3. IDLE COMMAND COUNT — an idle worker's actual commands/minute, measured,
//      so the reduction is a number rather than a claim and a future default
//      change cannot silently undo it.
//
// Runs against REDIS_TEST_URL if set (a disposable container), else the local
// dev Redis. Every test uses a uniquely-named queue and calls obliterate() in
// cleanup, so it never touches another queue's keys.

const REDIS_URL = process.env.REDIS_TEST_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379";

function connectionOpts() {
  const u = new URL(REDIS_URL);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    maxRetriesPerRequest: null,
  };
}

describe("WORKER_TUNING values", () => {
  it("raises drainDelay above BullMQ's default of 5s on every queue", () => {
    for (const [name, opts] of Object.entries(WORKER_TUNING)) {
      expect(opts.drainDelay, name).toBeGreaterThan(5);
    }
  });

  it("raises stalledInterval above BullMQ's default of 30s on every queue", () => {
    for (const [name, opts] of Object.entries(WORKER_TUNING)) {
      expect(opts.stalledInterval, name).toBeGreaterThan(30_000);
    }
  });

  it("keeps report-cards the most conservative queue (scale-to-zero machine)", () => {
    expect(WORKER_TUNING.reportCards.stalledInterval).toBeLessThan(
      WORKER_TUNING.curriculum.stalledInterval,
    );
    expect(WORKER_TUNING.reportCards.drainDelay).toBeLessThan(WORKER_TUNING.curriculum.drainDelay);
  });

  it("keeps imports' stalled window tighter than the background queues", () => {
    expect(WORKER_TUNING.imports.stalledInterval).toBeLessThan(
      WORKER_TUNING.ai.stalledInterval,
    );
  });
});

describe("BullMQ marker wake-up (real Redis)", () => {
  const created: Array<{ queue: Queue; worker?: Worker }> = [];

  afterEach(async () => {
    for (const { queue, worker } of created) {
      if (worker) await worker.close(true);
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    }
    created.length = 0;
  });

  it("picks up a job in UNDER 1s despite a 60s drainDelay", async () => {
    const name = `o3-marker-${Date.now()}`;
    const queue = new Queue(name, { connection: connectionOpts() });

    let resolvePicked: (ms: number) => void;
    const picked = new Promise<number>((r) => {
      resolvePicked = r;
    });

    let enqueuedAt = 0;
    const worker = new Worker(
      name,
      async () => {
        resolvePicked(Date.now() - enqueuedAt);
      },
      {
        connection: connectionOpts(),
        // The real production value for the imports queue.
        drainDelay: WORKER_TUNING.imports.drainDelay,
        stalledInterval: WORKER_TUNING.imports.stalledInterval,
      },
    );
    created.push({ queue, worker });

    // Wait until the worker is genuinely blocked on bzpopmin, so the job
    // arrives mid-block — the case a longer drainDelay could have broken.
    await new Promise<void>((r) => worker.once("drained", () => r()));
    await new Promise((r) => setTimeout(r, 250));

    enqueuedAt = Date.now();
    await queue.add("job", { hello: "world" });

    const latencyMs = await picked;
    // eslint-disable-next-line no-console
    console.log(
      `[O-3] marker wake-up latency with drainDelay=${WORKER_TUNING.imports.drainDelay}s: ${latencyMs}ms`,
    );

    expect(latencyMs).toBeLessThan(1_000);
  }, 30_000);
});

describe("BullMQ stalled-job recovery (real Redis)", () => {
  it("re-runs a job orphaned by a dead worker", async () => {
    const name = `o3-stalled-${Date.now()}`;
    const queue = new Queue(name, { connection: connectionOpts() });
    const spawned: Worker[] = [];

    // A short stalledInterval purely so the test is fast — this proves the
    // RECOVERY MECHANISM still works when stalledInterval is the only knob
    // changed. The production delay is WORKER_TUNING.<queue>.stalledInterval;
    // see this file's header and worker-tuning.ts for that trade-off.
    const STALLED_INTERVAL = 1_000;

    try {
      // Worker 1 takes the job and never finishes it, then is force-closed
      // without releasing the lock — what a SIGTERM/OOM mid-job looks like.
      let markStarted: () => void;
      const started = new Promise<void>((r) => {
        markStarted = r;
      });

      const w1 = new Worker(
        name,
        async () => {
          markStarted();
          await new Promise((r) => setTimeout(r, 60_000));
        },
        {
          connection: connectionOpts(),
          lockDuration: STALLED_INTERVAL,
          stalledInterval: STALLED_INTERVAL,
          drainDelay: WORKER_TUNING.imports.drainDelay,
        },
      );
      spawned.push(w1);

      await w1.waitUntilReady();
      await queue.add("job", { n: 1 });
      await started;
      await w1.close(true);

      // Worker 2 must find and re-run it via the stalled check.
      const start = Date.now();
      const reran = new Promise<number>((resolve) => {
        const w2 = new Worker(name, async () => Date.now() - start, {
          connection: connectionOpts(),
          lockDuration: STALLED_INTERVAL,
          stalledInterval: STALLED_INTERVAL,
          drainDelay: WORKER_TUNING.imports.drainDelay,
        });
        spawned.push(w2);
        w2.on("completed", () => resolve(Date.now() - start));
        void w2.waitUntilReady();
      });

      const recoveredMs = await reran;
      // eslint-disable-next-line no-console
      console.log(
        `[O-3] stalled job recovered and re-ran after ${recoveredMs}ms (stalledInterval=${STALLED_INTERVAL}ms)`,
      );

      expect(recoveredMs).toBeGreaterThan(0);
    } finally {
      for (const w of spawned) await w.close(true).catch(() => undefined);
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
    }
  }, 60_000);
});

describe("BullMQ idle command volume (real Redis, measured)", () => {
  let counter: Redis;

  beforeAll(() => {
    counter = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  });

  afterAll(async () => {
    await counter.quit();
  });

  async function commandsProcessed(): Promise<number> {
    const info = await counter.info("stats");
    const m = /total_commands_processed:(\d+)/.exec(info);
    return m ? Number(m[1]) : 0;
  }

  // Measures real commands/minute for one idle worker at the DEFAULT settings
  // versus the tuned ones, extrapolated from a short sample. Asserts only the
  // direction and rough magnitude — exact counts vary with Redis internals and
  // any other client on the same server.
  async function measureIdleRate(
    opts: { drainDelay: number; stalledInterval: number },
    sampleMs: number,
  ): Promise<number> {
    const name = `o3-idle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const queue = new Queue(name, { connection: connectionOpts() });
    const worker = new Worker(name, async () => undefined, {
      connection: connectionOpts(),
      ...opts,
    });
    await worker.waitUntilReady();
    await new Promise<void>((r) => worker.once("drained", () => r()));

    const before = await commandsProcessed();
    await new Promise((r) => setTimeout(r, sampleMs));
    const after = await commandsProcessed();

    await worker.close(true);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();

    // Subtract the 2 INFO calls this measurement itself makes.
    const delta = Math.max(0, after - before - 2);
    return (delta / sampleMs) * 60_000;
  }

  it("cuts an idle worker's commands/minute well below the BullMQ default", async () => {
    // The two samples are deliberately DIFFERENT lengths. A default worker
    // cycles every 5s, so 22s covers several cycles. A tuned worker blocks for
    // 60s at a time, so a 22s window can legitimately observe ZERO commands and
    // report a meaningless 0/min — the sample has to outlast one full cycle for
    // the rate to mean anything. 70s covers one block plus its moveToActive.
    const DEFAULT_SAMPLE_MS = 22_000;
    const TUNED_SAMPLE_MS = 70_000;

    const defaultRate = await measureIdleRate(
      { drainDelay: 5, stalledInterval: 30_000 },
      DEFAULT_SAMPLE_MS,
    );
    const tunedRate = await measureIdleRate(
      {
        drainDelay: WORKER_TUNING.imports.drainDelay,
        stalledInterval: WORKER_TUNING.imports.stalledInterval,
      },
      TUNED_SAMPLE_MS,
    );

    const reduction = defaultRate > 0 ? 1 - tunedRate / defaultRate : 0;
    // eslint-disable-next-line no-console
    console.log(
      `[O-3] idle commands/min — default: ${defaultRate.toFixed(1)}, tuned: ${tunedRate.toFixed(1)}, reduction: ${(reduction * 100).toFixed(1)}%`,
    );

    // The default should land near the documented 26/min (12 bzpopmin +
    // 12 moveToActive + 2 stalled). Generous bounds: this is a real server.
    expect(defaultRate).toBeGreaterThan(12);
    // The tuned worker must be dramatically quieter.
    expect(tunedRate).toBeLessThan(defaultRate / 2);
    expect(reduction).toBeGreaterThan(0.5);
  }, 240_000);
});
