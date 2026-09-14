import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Standing gate for the Recording Completeness report's transaction budget.
//
// Found 2026-09-14 during CP2's live production verification
// (docs/modules/phase-8.md §16.12): one school's report transaction ran past
// Prisma's 5000 ms interactive-transaction default — withTenant logged
// "retrying after connection-level error (P2028) after 5024ms — body ran long".
// The retry succeeded, but that is the same failure class as the 2026-09-11
// /dashboard incident: ~12 statements serialised on ONE connection across the
// Fly-Johannesburg → Neon-Frankfurt hop, with a 5 s budget.
//
// The fix mirrors the dashboard's proven DASHBOARD_TRANSACTION_TIMEOUT_MS. This
// spec pins it the way dashboard-transaction.spec.ts pins its own invariant: by
// recording the options each withTenant entry receives. It asserts, for both
// endpoints:
//   * exactly ONE report transaction per request (never a second, nested one),
//   * that transaction carries timeoutMs 15000 and a diagnostic label.
// Timing is never involved, so the gate is deterministic on any machine.
// ---------------------------------------------------------------------------

const calls: Array<{ label?: string; timeoutMs?: number }> = [];

vi.mock("@school-kit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@school-kit/db")>();
  return {
    ...actual,
    withTenant: (...args: Parameters<typeof actual.withTenant>) => {
      const options = args[2];
      calls.push({ label: options?.label, timeoutMs: options?.timeoutMs });
      return actual.withTenant(...args);
    },
  };
});

// Static imports: vi.mock is hoisted above them (see dashboard-transaction.spec.ts).
import { basePrisma } from "@school-kit/db";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthService } from "../auth/auth.service.js";
import { CalendarService } from "../calendar/calendar.service.js";
import { CompletenessService, REPORTS_TRANSACTION_TIMEOUT_MS } from "./completeness.service.js";

let phone = 0;
const randomPhone = () =>
  `+23483${String(++phone % 100).padStart(2, "0")}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

describe("reports transaction budget (P2028 regression gate)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolId: string;
  let owner: AuthContext;

  beforeEach(() => {
    calls.length = 0;
  });

  afterAll(async () => {
    if (schoolId) await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  it("uses the dashboard's proven 15-second budget", () => {
    expect(REPORTS_TRANSACTION_TIMEOUT_MS).toBe(15_000);
  });

  it("GET /reports/completeness and /reports/teacher-activity each open exactly ONE report transaction, with timeoutMs 15000", async () => {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Reports Tx ${runId}`,
        schoolSlug: `rep-tx-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `rep-tx-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    schoolId = signed.school.id;
    owner = { sessionId: "s", userId: signed.user.id, schoolId } as AuthContext;
    const service = new CompletenessService(new CalendarService());

    for (const [label, run] of [
      ["reports.getCompleteness", () => service.getCompleteness(owner, undefined)],
      ["reports.getTeacherActivity", () => service.getTeacherActivity(owner, undefined, { ipAddress: "127.0.0.1" })],
    ] as const) {
      calls.length = 0;
      await run();
      // The role check (assertUserActiveAndHasOneOf) opens its own short
      // transaction BEFORE the report body — that is unchanged and not the
      // long one. The report body must be exactly one labelled transaction.
      const reportTx = calls.filter((c) => c.label === label);
      expect(reportTx, label).toEqual([{ label, timeoutMs: 15_000 }]);
      expect(calls.filter((c) => c.label?.startsWith("reports.")), label).toHaveLength(1);
    }
  });
});
