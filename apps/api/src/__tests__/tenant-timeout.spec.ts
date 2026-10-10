import * as crypto from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

// 2026-08-04 gradebook-save incident: withTenant gained an optional
// { timeoutMs } override (assessment.service.ts's bulkUpsertScores is the
// first caller) so a specific transaction can ask for more than Prisma's
// 5000ms interactive-transaction default without changing the default for
// every other withTenant caller. This spec verifies the option is actually
// wired through to Prisma's $transaction, not just accepted and ignored, and
// that omitting it is still the unchanged default behavior.
describe("withTenant timeoutMs option", () => {
  afterAll(async () => {
    await basePrisma.$disconnect();
  });

  it("a deliberately slow body past a tiny explicit timeoutMs throws Prisma's transaction-timeout error", async () => {
    const schoolId = crypto.randomUUID(); // any well-formed UUID — no real school needed for a GUC-only tx
    await expect(
      withTenant(
        schoolId,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow(/transaction/i);
  });

  // 2026-10-10: a body timeout (P2028 "Transaction already closed") used to be
  // retried, re-running the whole slow transaction on a second connection.
  // Only the never-started P2028 ("Unable to start a transaction") is retried
  // now. Both ways a body can outlive its budget are pinned: a query issued
  // after the deadline, and a body that finishes late and fails at commit.
  it("a body timeout surfacing at the next query runs the body exactly once", async () => {
    let runs = 0;
    await expect(
      withTenant(
        crypto.randomUUID(),
        async (tx) => {
          runs += 1;
          await new Promise((resolve) => setTimeout(resolve, 200));
          await tx.$executeRaw`SELECT 1`;
        },
        { timeoutMs: 50 },
      ),
    ).rejects.toMatchObject({ code: "P2028" });
    expect(runs).toBe(1);
  });

  it("a body timeout surfacing at commit runs the body exactly once", async () => {
    let runs = 0;
    await expect(
      withTenant(
        crypto.randomUUID(),
        async () => {
          runs += 1;
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow(/transaction/i);
    expect(runs).toBe(1);
  });

  it("a body well within a generous explicit timeoutMs succeeds normally", async () => {
    const schoolId = crypto.randomUUID();
    const result = await withTenant(schoolId, async () => "ok", { timeoutMs: 15_000 });
    expect(result).toBe("ok");
  });

  it("omitting the options param keeps the unchanged default behavior", async () => {
    const schoolId = crypto.randomUUID();
    const result = await withTenant(schoolId, async () => "default-ok");
    expect(result).toBe("default-ok");
  });
});
