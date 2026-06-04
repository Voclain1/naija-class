import { exec } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { FilesystemStorageDriver } from "../../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../../common/storage/storage.service";
import { AggregationService } from "../../assessment/aggregation.service";
import { AuthService } from "../../auth/auth.service";
import { ReportCardService } from "../report-card.service";
import { BrowserPool } from "./browser-pool";
import { RenderService } from "./render.service";

// ===========================================================================
// THE 40-CARD MEMORY-BUDGET GATE (slice 5 cp2, load-bearing verification).
//
// Builds a 40-student arm, renders all 40 cards sequentially through the
// pooled single browser at concurrency 1, and samples peak memory:
//   - Node API process: peak RSS + peak heapUsed (the in-process footprint).
//   - Chromium tree: peak summed working set of every puppeteer chrome.exe
//     (sampled via Win32_Process; Chromium runs OUT of the Node process so
//     Node RSS alone understates the container footprint).
//   - Combined peak ≈ node RSS + chromium tree — this is what a fly.io cgroup
//     would account.
//
// NOT part of the default suite — it spawns 40 real renders (~30s) and is a
// measurement, not an assertion. Guarded behind RUN_MEMORY_GATE=1 so the
// normal `pnpm test` skips it. Run on demand:
//
//   RUN_MEMORY_GATE=1 pnpm --filter @school-kit/api exec dotenv -e ../../.env \
//     -- vitest run src/modules/report-cards/render/memory-gate.spec.ts
//
// Kept in-repo because the deferred in-container (fly.io Linux) re-validation
// re-runs exactly this harness. Numbers go in the journal + cp2 report.
// Measured on Windows dev — NOT validated inside a fly.io Linux container
// (see docs/deferred.md). Caveats on the Windows number: (1) Linux headless
// Chromium is lighter than Windows; (2) Win32 WorkingSetSize counts shared
// pages per-process, so the Chromium-tree figure OVERESTIMATES true unique
// RSS. The real Linux/cgroup footprint is expected lower than measured here.
// ===========================================================================

const RUN_GATE = process.env.RUN_MEMORY_GATE === "1";

const STUDENT_COUNT = 40;
const SUBJECTS = 8;
const BUDGET_512 = 512;
const BUDGET_1024 = 1024;

let c = 0;
function phone(): string {
  c += 1;
  return `+23498${(c % 100).toString().padStart(2, "0")}${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
}
const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

const execAsync = promisify(exec);

// Peak summed working set (bytes) of every puppeteer-owned chrome.exe. Filtered
// by ExecutablePath so the developer's own Chrome is excluded. ASYNC so the
// sampler never blocks the event loop (a blocking sampler starves the CDP
// websocket and slows/wedges the very render we're measuring).
async function sampleChromiumBytes(): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.ExecutablePath -like '*puppeteer*' -or $_.ExecutablePath -like '*.cache*chrome*' } | Measure-Object -Property WorkingSetSize -Sum).Sum"`,
      { windowsHide: true },
    );
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

const MB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

describe.runIf(RUN_GATE)("40-card memory gate", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  let schoolId: string;
  let ownerId: string;
  let armId: string;
  let termId: string;
  let cardIds: string[] = [];
  let storageRoot: string;
  let pool: BrowserPool;
  let render: RenderService;

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "rc-gate-"));
    const storage = new StorageService(new FilesystemStorageDriver(storageRoot));
    pool = new BrowserPool();
    const reportCards = new ReportCardService(new AggregationService(), storage, {
      add: async () => undefined,
    } as never);
    render = new RenderService(reportCards, storage, pool);

    const signed = await auth.signupOwner(
      {
        schoolName: "Gate Academy",
        schoolSlug: `gate-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `gate-${runId}@example.test`,
        ownerPhone: phone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolId = signed.school.id;
    ownerId = signed.user.id;
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });

    const built = await withTenant(schoolId, async (db) => {
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "Gate A", code: `gate-${runId}` },
        select: { id: true },
      });
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
          isCurrent: true,
        },
        select: { id: true },
      });
      const subjects: string[] = [];
      for (let s = 0; s < SUBJECTS; s++) {
        const subj = await db.subject.create({
          data: { schoolId, name: `Subject ${s + 1}`, code: `sub${s}-${runId}` },
          select: { id: true },
        });
        subjects.push(subj.id);
      }
      for (let i = 0; i < STUDENT_COUNT; i++) {
        const student = await db.student.create({
          data: {
            schoolId,
            admissionNumber: `ADM-${i}-${runId}`,
            firstName: `Student${i}`,
            lastName: `Surname${i}`,
            dateOfBirth: new Date("2013-05-10"),
            gender: i % 2 === 0 ? "FEMALE" : "MALE",
          },
          select: { id: true },
        });
        await db.enrollment.create({
          data: { schoolId, studentId: student.id, termId: term.id, academicYearId: year.id, classArmId: arm.id, status: "ENROLLED" },
        });
        for (const subjectId of subjects) {
          await db.assessment.create({
            data: {
              schoolId,
              studentId: student.id,
              subjectId,
              termId: term.id,
              academicYearId: year.id,
              classArmId: arm.id,
              totalScore: 40 + ((i * 7 + subjects.indexOf(subjectId) * 3) % 60),
              computedAt: new Date(),
            },
          });
        }
      }
      return { armId: arm.id, termId: term.id };
    });
    armId = built.armId;
    termId = built.termId;

    await render["reportCards"].build(ctx(schoolId, ownerId), { termId, classArmId: armId }, reqCtx);
    const cards = await withTenant(schoolId, (db) =>
      db.reportCard.findMany({ where: { termId, classArmId: armId }, select: { id: true } }),
    );
    cardIds = cards.map((x) => x.id);
  }, 120_000);

  afterAll(async () => {
    await pool.onModuleDestroy();
    await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
    await basePrisma.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it(`renders ${STUDENT_COUNT} cards and reports peak memory vs fly.io budgets`, async () => {
    expect(cardIds.length).toBe(STUDENT_COUNT);

    let peakRss = 0;
    let peakHeap = 0;
    let peakChromium = 0;
    let peakCombined = 0;
    let lastChromium = 0;
    let sampling = false;
    const sampler = setInterval(() => {
      const m = process.memoryUsage();
      peakRss = Math.max(peakRss, m.rss);
      peakHeap = Math.max(peakHeap, m.heapUsed);
      // Combine Node RSS with the most recent (async) Chromium reading.
      peakCombined = Math.max(peakCombined, m.rss + lastChromium);
      if (sampling) return;
      sampling = true;
      void sampleChromiumBytes().then((bytes) => {
        lastChromium = bytes;
        peakChromium = Math.max(peakChromium, bytes);
        peakCombined = Math.max(peakCombined, process.memoryUsage().rss + bytes);
        sampling = false;
      });
    }, 200);

    const startedAt = Date.now();
    for (const cardId of cardIds) {
      await render.renderCard({ schoolId, userId: ownerId, reportCardId: cardId, attempt: 1 });
    }
    const wallMs = Date.now() - startedAt;
    clearInterval(sampler);
    // One final synchronous-ish sample after the loop (browser still alive).
    const finalChromium = await sampleChromiumBytes();
    peakChromium = Math.max(peakChromium, finalChromium);
    peakCombined = Math.max(peakCombined, process.memoryUsage().rss + finalChromium);

    const verdict = (budget: number) => {
      const pct = (peakCombined / 1024 / 1024 / budget) * 100;
      const tag = pct < 70 ? "GREEN" : pct <= 95 ? "FLAG" : "FAIL";
      return `${tag} (${pct.toFixed(1)}% of ${budget}MB)`;
    };

    /* eslint-disable no-console */
    console.log("\n========== 40-CARD MEMORY GATE ==========");
    console.log(`cards rendered      : ${cardIds.length}`);
    console.log(`wall-clock          : ${wallMs} ms  (${(wallMs / cardIds.length).toFixed(0)} ms/card)`);
    console.log(`peak Node heapUsed  : ${MB(peakHeap)} MB`);
    console.log(`peak Node RSS       : ${MB(peakRss)} MB`);
    console.log(`peak Chromium tree  : ${MB(peakChromium)} MB`);
    console.log(`peak COMBINED       : ${MB(peakCombined)} MB`);
    console.log(`vs fly.io 512MB     : ${verdict(BUDGET_512)}`);
    console.log(`vs fly.io 1024MB    : ${verdict(BUDGET_1024)}`);
    console.log("=========================================\n");
    /* eslint-enable no-console */

    // Every card must have rendered.
    const statuses = await withTenant(schoolId, (db) =>
      db.reportCard.findMany({ where: { termId, classArmId: armId }, select: { pdfStatus: true } }),
    );
    expect(statuses.every((s) => s.pdfStatus === "GENERATED")).toBe(true);
  }, 300_000);
});
