import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { AuthService } from "../auth/auth.service.js";
import { DashboardService } from "./dashboard.service.js";

// ---------------------------------------------------------------------------
// The REPRODUCTION for the 2026-09-11 /dashboard deadlock. Opt-in, not part of
// the normal suite.
//
//   SK_POOL_PROBE=1 \
//   DATABASE_URL="postgresql://app_user:app_user@localhost:5432/school_kit?schema=public&connection_limit=3&pool_timeout=10" \
//     pnpm --filter @school-kit/api exec vitest run src/modules/dashboard/dashboard-pool-probe.spec.ts
//
// WHY IT IS OPT-IN. It needs a pool of 3 to reproduce anything, and pool size
// is fixed by DATABASE_URL when basePrisma is first imported. apps/api's
// vitest runs pool:"forks" with singleFork:true, so every spec file shares one
// process and one basePrisma — left enabled, this would shrink the pool for
// the entire suite. Running it alone, in its own invocation, is the whole
// point: that is what makes the constrained pool safe.
//
// connection_limit=3 is not arbitrary. Production is a 1-vCPU Fly machine and
// nothing in the repo sets connection_limit, so Prisma's default applies:
// num_physical_cpus * 2 + 1 = 3.
//
// WHAT IT PROVES. Before the fix, DashboardService's withTenant awaited
// FinanceService.getDashboard()'s own withTenant — a second pooled connection
// acquired while the first was still held. N concurrent loads each held one
// connection and waited for one that could never be freed.
//
// Measured 2026-09-11 against local Postgres with ZERO network latency, this
// exact probe, connection_limit=3, first on the unfixed code and then on the
// fix, changing nothing else:
//
//         BEFORE                           AFTER
//   N=1   OK        36ms                   OK     34ms
//   N=2   OK        61ms                   OK    181ms
//   N=3   OK      5080ms  <- see below     OK    127ms
//   N=4   0/4 OK  9568ms  P2028            OK    163ms
//   N=5   2/5 OK  9625ms  P2028            OK    192ms
//   N=6   0/6 OK  9647ms  P2028            OK    159ms
//   ...                                    OK through N=40, six runs
//
// N=3 BEFORE is the detail worth keeping: it did not fail, it took FIVE
// SECONDS, because withTenant's retry rescued it after the transaction blew
// its budget. That is the shape a user reports as "the dashboard is slow
// sometimes" rather than as an error — and the retry that rescued it re-ran
// the whole transaction, adding load at the exact moment the pool was
// exhausted. N=5 partially succeeding (2 of 5) where N=4 and N=6 failed
// outright is the non-determinism behind "a refresh sometimes fixes it".
//
// After the fix the handler opens one transaction, so hold-and-wait is gone.
// The standing CI gate for the invariant is dashboard-transaction.spec.ts,
// which needs no concurrency and no pool tuning; this file is the evidence
// behind it.
//
// HONEST LIMIT: one run at N<=40 did fail, during the same window this machine
// was throwing fork/OOM errors under load, and it did not reproduce in six
// consecutive runs afterwards. Not claimed as proven absent.
// ---------------------------------------------------------------------------

const ENABLED = process.env.SK_POOL_PROBE === "1";
const MAX_CONCURRENCY = Number(process.env.SK_POOL_PROBE_MAX ?? 6);

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23484${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

describe.skipIf(!ENABLED)("GET /dashboard under a production-sized pool", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it(`survives up to ${MAX_CONCURRENCY} concurrent loads`, async () => {
    const limit = /connection_limit=(\d+)/.exec(process.env.DATABASE_URL ?? "")?.[1];
    // eslint-disable-next-line no-console
    console.log(
      `[probe] connection_limit=${limit ?? "UNSET (Prisma default applies)"} — ` +
        `set it to 3 to match production, or this proves nothing`,
    );

    const signed = await auth.signupOwner(
      {
        schoolName: `Pool ${runId}`,
        schoolSlug: `pool-${runId}`,
        ownerFirstName: "Bisi",
        ownerLastName: "Admin",
        ownerEmail: `pool-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "test" },
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);

    const termId = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/2026-pool-${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
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
      return term.id;
    });

    const svc = new DashboardService();
    const authCtx = { sessionId: "sess", userId: signed.user.id, schoolId };

    await svc.getAdminDashboard(authCtx, termId); // warm the pool

    const failures: string[] = [];
    for (let n = 1; n <= MAX_CONCURRENCY; n++) {
      const started = Date.now();
      const results = await Promise.allSettled(
        Array.from({ length: n }, () => svc.getAdminDashboard(authCtx, termId)),
      );
      const failed = results.filter((r) => r.status === "rejected");
      const codes = failed.map(
        (r) => (r as PromiseRejectedResult).reason?.code ?? "unknown",
      );
      // eslint-disable-next-line no-console
      console.log(
        `[probe] N=${n}: ${results.length - failed.length}/${n} OK in ${Date.now() - started}ms` +
          (failed.length ? `  FAILED codes=${[...new Set(codes)].join(",")}` : ""),
      );
      if (failed.length) failures.push(`N=${n}: ${failed.length}/${n} failed (${[...new Set(codes)].join(",")})`);
    }

    expect(failures).toEqual([]);
  }, 120_000);
});
