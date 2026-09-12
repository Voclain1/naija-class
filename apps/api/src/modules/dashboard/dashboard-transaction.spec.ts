import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The standing regression gate for the 2026-09-11 /dashboard incident.
//
// GET /dashboard used to open TWO transactions per request: DashboardService's
// own withTenant, which then awaited FinanceService.getDashboard() — its own
// withTenant, and therefore its own SECOND pool connection, acquired while the
// first was still held. That is hold-and-wait: once concurrent dashboard loads
// reached the pool size (3 on the production 1-vCPU Fly machine, Prisma's
// num_cpus * 2 + 1 default), every request held one connection and waited for
// one that could never be freed. Reproduced at exactly that threshold against
// local Postgres with ZERO network latency: 1 OK, 2 OK, 3 -> all three fail
// P2028 "Unable to start a transaction in the given time."
//
// WHY THIS GATE COUNTS withTenant ENTRIES RATHER THAN RECONSTRUCTING THE
// DEADLOCK: the deadlock only manifests when the pool is small, and pool size
// is fixed by DATABASE_URL when `basePrisma` is first imported. apps/api's
// vitest runs `pool: "forks"` with `singleFork: true`, so every spec file
// shares one process and one basePrisma — a spec cannot shrink the pool
// without shrinking it for the whole suite. Counting is also the STRONGER
// gate: it fails deterministically at any pool size, on any machine, with no
// concurrency and no timing involved. The deadlock itself is reproduced
// out-of-band by scripts/dashboard-pool-probe.ts against a real HTTP server.
//
// withTenant entries, not Postgres transactions, because they are the same
// number by construction (every withTenant opens exactly one $transaction) and
// only the former can be counted exactly. pg_stat_database.xact_commit was
// tried first and rejected: backends flush those counters on an interval
// rather than at commit, so sub-second successive transactions do not register
// and the gate passed against the KNOWN-BROKEN code. A gate that cannot fail
// is worse than no gate.
// ---------------------------------------------------------------------------

const withTenantCalls = { count: 0 };

vi.mock("@school-kit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@school-kit/db")>();
  return {
    ...actual,
    withTenant: (...args: Parameters<typeof actual.withTenant>) => {
      withTenantCalls.count += 1;
      return actual.withTenant(...args);
    },
  };
});

// Static imports, not `await import(...)`: apps/api compiles to CommonJS, so
// top-level await is a typecheck error even though vitest's SWC pipeline
// accepts it. vi.mock above is hoisted over these by vitest, so the spy is in
// place before any of them resolve.
import { basePrisma, withTenant } from "@school-kit/db";

import { AuthService } from "../auth/auth.service.js";
import { DashboardService } from "./dashboard.service.js";

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23484${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

describe("GET /dashboard transaction count (deadlock regression gate)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const schoolIds = new Set<string>();

  beforeEach(() => {
    withTenantCalls.count = 0;
  });

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("opens exactly ONE transaction per request", async () => {
    const signed = await auth.signupOwner(
      {
        schoolName: `Dash Tx ${runId}`,
        schoolSlug: `dash-tx-${runId}`,
        ownerFirstName: "Bisi",
        ownerLastName: "Admin",
        ownerEmail: `dash-tx-${runId}@example.test`,
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
          label: `2025/2026-tx-${runId}`,
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

    // Sanity-check the counter itself against a call of known arity, so a
    // broken spy cannot make the real assertion below pass vacuously.
    withTenantCalls.count = 0;
    await withTenant(schoolId, async (db) => db.term.count());
    expect(withTenantCalls.count).toBe(1);

    const svc = new DashboardService();
    const authCtx = { sessionId: "sess", userId: signed.user.id, schoolId };

    withTenantCalls.count = 0;
    await svc.getAdminDashboard(authCtx, termId);

    // eslint-disable-next-line no-console
    console.log(`[gate] withTenant entries per GET /dashboard: ${withTenantCalls.count}`);

    // ONE. Not two. A second transaction here means someone reintroduced a
    // nested withTenant on this path and the production deadlock is back.
    expect(withTenantCalls.count).toBe(1);
  });
});
