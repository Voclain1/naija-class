#!/usr/bin/env node
// Online exams — the exam-day load test (docs/modules/cbt.md D10;
// docs/runbooks/cbt-go-live.md). The go-live gate: before any school's first
// live exam, this must pass against the exam service at the target number of
// computers.
//
// It plays a whole lab at once, exactly as the exam app does (the same
// `@school-kit/types` crypto the browser uses):
//   1. every computer downloads the pack at the same moment;
//   2. each one signs in a student (cycling through the register) and sends
//      a growing snapshot of answers every --interval seconds, for --minutes;
//   3. each one finishes with a submitted snapshot.
// Then it reports latency (p50 / p95 / max) and every non-200, and exits 1 if
// the thresholds are missed.
//
// It WRITES real attempts to the sitting it is pointed at. Point it only at a
// sitting in a school made for the test, and delete that school afterwards
// (the runbook has the steps).
//
// Usage (from the repo root, after `pnpm --filter @school-kit/types build`):
//   node apps/cbt/scripts/load-test.mjs \
//     --api https://school-kit-cbt.fly.dev/api/v1 \
//     --slug load-test-school --access ABC234 --unlock ABCD-EFGH-JKMN \
//     --machines 200 --minutes 5 --interval 30
//
// Every computer in a lab reaches the service from ONE address (the school's
// router), and so does this script: it measures the per-address throttle as a
// real lab meets it.

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { CBT_SIGNATURE_HEADER, deriveSyncKey, openPackInBrowser, signSyncBody } from "@school-kit/types";

const { values: args } = parseArgs({
  options: {
    api: { type: "string", default: "http://localhost:4000/api/v1" },
    slug: { type: "string" },
    access: { type: "string" },
    unlock: { type: "string" },
    machines: { type: "string", default: "200" },
    minutes: { type: "string", default: "5" },
    interval: { type: "string", default: "30" },
    "p95-ms": { type: "string", default: "1500" },
  },
});
if (!args.slug || !args.access || !args.unlock) {
  console.error("Needs --slug, --access and --unlock (from the invigilator sheet). See the header of this file.");
  process.exit(2);
}
const API = args.api.replace(/\/$/, "");
const MACHINES = Number(args.machines);
const ROUNDS = Math.max(1, Math.round((Number(args.minutes) * 60) / Number(args.interval)));
const INTERVAL_MS = Number(args.interval) * 1000;
const P95_LIMIT = Number(args["p95-ms"]);

const timings = { download: [], sync: [] };
const failures = new Map(); // "sync 429" → count

async function timed(kind, fn) {
  const t0 = performance.now();
  let status = 0;
  try {
    const res = await fn();
    status = res.status;
    if (!res.ok) throw new Error(String(status));
    return await res.json();
  } catch (e) {
    const key = `${kind} ${status || e.message}`;
    failures.set(key, (failures.get(key) ?? 0) + 1);
    return null;
  } finally {
    timings[kind].push(performance.now() - t0);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(list, p) {
  if (list.length === 0) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function main() {
  console.info(`Exam service ${API} · ${MACHINES} computers · ${ROUNDS} syncs each, every ${args.interval}s`);

  // ---- 1. Every computer downloads at once ---------------------------------
  const packUrl = `${API}/cbt-delivery/${encodeURIComponent(args.slug)}/packs/${encodeURIComponent(args.access)}`;
  const downloads = await Promise.all(Array.from({ length: MACHINES }, () => timed("download", () => fetch(packUrl))));
  const envelope = downloads.find(Boolean)?.envelope;
  if (!envelope) {
    console.error("No computer could download the pack. Check --api, --slug and --access.");
    report();
    process.exit(1);
  }

  // One unlock for the whole run: every machine derives the same keys, and
  // PBKDF2 at 210,000 rounds per simulated machine would load THIS computer,
  // not the service.
  const payload = await openPackInBrowser(envelope, args.unlock);
  const key = await deriveSyncKey(args.unlock, envelope.sittingId, envelope.kdf.iterations);
  const syncUrl = `${API}/cbt-delivery/${encodeURIComponent(args.slug)}/sittings/${envelope.sittingId}/answers`;
  console.info(`Opened "${envelope.title}": ${payload.candidates.length} students, ${payload.questionCount} questions.`);

  // ---- 2–3. Each computer sits one student --------------------------------
  const startedAt = new Date().toISOString();
  async function machine(i) {
    const candidate = payload.candidates[i % payload.candidates.length];
    const questions = (payload.versions[candidate.version] ?? []).flatMap((s) => s.questions);
    const deviceId = randomUUID();
    const answers = {};
    await sleep(Math.random() * INTERVAL_MS); // computers do not tick together
    for (let round = 1; round <= ROUNDS; round += 1) {
      const upTo = Math.ceil((questions.length * round) / ROUNDS);
      for (const q of questions.slice(0, upTo)) answers[q.itemId] ??= q.options[Math.floor(Math.random() * q.options.length)].id;
      const last = round === ROUNDS;
      const body = JSON.stringify({
        deviceId,
        attempts: [
          {
            studentId: candidate.studentId,
            seq: round + 1,
            startedAt,
            submittedAt: last ? new Date().toISOString() : null,
            extraMinutes: 0,
            focusLosses: 0,
            answers,
          },
        ],
      });
      const signature = await signSyncBody(key, body);
      await timed("sync", () =>
        fetch(syncUrl, { method: "POST", headers: { "Content-Type": "application/json", [CBT_SIGNATURE_HEADER]: signature }, body }),
      );
      if (!last) await sleep(INTERVAL_MS);
    }
  }
  await Promise.all(Array.from({ length: MACHINES }, (_, i) => machine(i)));

  const ok = report();
  process.exit(ok ? 0 : 1);
}

function report() {
  const line = (kind) => {
    const t = timings[kind];
    return `${kind.padEnd(8)} ${String(t.length).padStart(6)} requests · p50 ${percentile(t, 50).toFixed(0)} ms · p95 ${percentile(t, 95).toFixed(0)} ms · max ${Math.max(0, ...t).toFixed(0)} ms`;
  };
  console.info("\n" + line("download") + "\n" + line("sync"));
  const failed = [...failures.values()].reduce((a, b) => a + b, 0);
  for (const [k, n] of failures) console.info(`  FAILED ${k}: ${n}`);
  const p95 = Math.max(percentile(timings.download, 95), percentile(timings.sync, 95));
  const ok = failed === 0 && p95 <= P95_LIMIT;
  console.info(ok ? `\nPASS — no failures, p95 ${p95.toFixed(0)} ms ≤ ${P95_LIMIT} ms` : `\nFAIL — ${failed} failed requests, p95 ${p95.toFixed(0)} ms (limit ${P95_LIMIT} ms)`);
  return ok;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
