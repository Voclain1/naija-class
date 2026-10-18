import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { feeRiskSummary } from "@school-kit/types";

import { AuthService } from "../auth/auth.service.js";
import { assessFeeRisk, computeFeeRisks, termOutcome, type FeeHistory } from "./fee-risk.js";
import { FinanceService } from "./finance.service.js";

// Phase 9 / CP10.2 — fee-default risk (docs/modules/phase-9.md §19.3, §19.4).

const base: FeeHistory = { recent: [], earlierOwing: [], overdueNow: 0, termsWithInvoices: 4 };

describe("assessFeeRisk — the rules", () => {
  it("on time every term is Low, and says so", () => {
    const r = assessFeeRisk({ ...base, recent: ["ON_TIME", "ON_TIME", "ON_TIME"] });
    expect(r).toEqual({ level: "LOW", reasons: [{ kind: "ON_TIME", of: 3 }] });
    expect(feeRiskSummary(r)).toBe("Paid on time in the last 3 terms");
  });

  it("one late term is Watch", () => {
    const r = assessFeeRisk({ ...base, recent: ["ON_TIME", "PAID_LATE", "ON_TIME"] });
    expect(r.level).toBe("WATCH");
    expect(feeRiskSummary(r)).toBe("Paid late in 1 of the last 3 terms");
  });

  it("one part-paid term is Watch", () => {
    const r = assessFeeRisk({ ...base, recent: ["SHORT_AT_DUE", "ON_TIME"] });
    expect(r.level).toBe("WATCH");
    expect(feeRiskSummary(r)).toBe("Not paid in full by the due date in 1 of the last 2 terms");
  });

  it("overdue now alone is Watch", () => {
    const r = assessFeeRisk({ ...base, recent: ["ON_TIME", "ON_TIME"], overdueNow: 2_500_000 });
    expect(r.level).toBe("WATCH");
    expect(feeRiskSummary(r)).toBe("₦25,000.00 overdue this term");
  });

  it("late in 2 of the last 3 terms is Watch until this term is overdue too, then High", () => {
    expect(assessFeeRisk({ ...base, recent: ["PAID_LATE", "SHORT_AT_DUE", "ON_TIME"] }).level).toBe("WATCH");
    const r = assessFeeRisk({ ...base, recent: ["PAID_LATE", "PAID_LATE", "ON_TIME"], overdueNow: 100 });
    expect(r.level).toBe("HIGH");
    expect(feeRiskSummary(r)).toBe("₦1.00 overdue this term; Paid late in 2 of the last 3 terms");
  });

  it("a balance still owing from an earlier term is High, with the amount and the term", () => {
    const r = assessFeeRisk({ ...base, recent: ["ON_TIME"], earlierOwing: [{ termLabel: "Second Term 2025/2026", balance: 4_500_000 }] });
    expect(r.level).toBe("HIGH");
    expect(feeRiskSummary(r)).toBe("₦45,000.00 still owing from Second Term 2025/2026");
  });

  it("fewer than two terms of fees is Too new to say", () => {
    const r = assessFeeRisk({ ...base, termsWithInvoices: 1, overdueNow: 5_000 });
    expect(r.level).toBe("TOO_NEW");
    expect(feeRiskSummary(r)).toBe("Fewer than two terms of fees so far; ₦50.00 overdue this term");
  });

  it("termOutcome: by the due date, after it, or still short", () => {
    expect(termOutcome({ totalDue: 100, totalPaid: 100, paidByDue: 100 })).toBe("ON_TIME");
    expect(termOutcome({ totalDue: 100, totalPaid: 100, paidByDue: 40 })).toBe("PAID_LATE");
    expect(termOutcome({ totalDue: 100, totalPaid: 60, paidByDue: 60 })).toBe("SHORT_AT_DUE");
    expect(termOutcome({ totalDue: 0, totalPaid: 0, paidByDue: 0 })).toBe("ON_TIME");
  });
});

describe("computeFeeRisks — against a real database", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const schoolIds: string[] = [];
  let schoolId = "";
  let ownerId = "";
  const termIds: string[] = []; // oldest first; the last is the term being looked at
  const TODAY = "2026-06-01";

  async function makeSchool(tag: string) {
    const signed = await auth.signupOwner(
      {
        schoolName: `Risk ${tag} ${runId}`,
        schoolSlug: `risk-${tag}-${runId}`,
        ownerFirstName: "Bola",
        ownerLastName: "Owner",
        ownerEmail: `risk-${tag}-${runId}@example.test`,
        ownerPhone: `+23481${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "test" },
    );
    schoolIds.push(signed.school.id);
    await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

  async function student(first: string): Promise<string> {
    return withTenant(schoolId, async (db) =>
      (
        await db.student.create({
          data: { schoolId, admissionNumber: `R-${first}-${runId}`, firstName: first, lastName: "Okafor", dateOfBirth: d("2012-01-01"), gender: "FEMALE" },
          select: { id: true },
        })
      ).id,
    );
  }

  /** A term invoice with optional payments: [amount, paid on]. */
  async function invoice(studentId: string, termIdx: number, totalDue: number, payments: [number, string][], dueDate: string, sequence = 0) {
    await withTenant(schoolId, async (db) => {
      const t = await db.term.findUniqueOrThrow({ where: { id: termIds[termIdx] }, select: { academicYearId: true } });
      const paid = payments.reduce((s, [a]) => s + a, 0);
      const inv = await db.invoice.create({
        data: {
          schoolId,
          studentId,
          termId: termIds[termIdx]!,
          academicYearId: t.academicYearId,
          status: paid >= totalDue ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : "ISSUED",
          items: [],
          totalAmount: totalDue,
          totalDiscount: 0,
          totalDue,
          totalPaid: paid,
          dueDate: d(dueDate),
          sequence,
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
        select: { id: true },
      });
      for (const [amount, on] of payments) {
        await db.payment.create({
          data: { schoolId, invoiceId: inv.id, studentId, amount, method: "CASH", status: "SUCCESS", paidAt: new Date(`${on}T10:00:00.000Z`), recordedBy: ownerId },
        });
      }
    });
  }

  beforeAll(async () => {
    ({ schoolId, ownerId } = await makeSchool("a"));
    await withTenant(schoolId, async (db) => {
      const y1 = await db.academicYear.create({ data: { schoolId, label: `2024/2025-${runId}`, startDate: d("2024-09-01"), endDate: d("2025-07-31") }, select: { id: true } });
      const y2 = await db.academicYear.create({ data: { schoolId, label: `2025/2026-${runId}`, startDate: d("2025-09-01"), endDate: d("2026-07-31") }, select: { id: true } });
      const plan: [string, number, string, string, string][] = [
        [y1.id, 3, "Third Term", "2025-04-20", "2025-07-25"],
        [y2.id, 1, "First Term", "2025-09-08", "2025-12-12"],
        [y2.id, 2, "Second Term", "2026-01-05", "2026-04-02"],
        [y2.id, 3, "Third Term", "2026-04-20", "2026-07-24"],
      ];
      for (const [academicYearId, sequence, name, start, end] of plan) {
        termIds.push((await db.term.create({ data: { schoolId, academicYearId, sequence, name, startDate: d(start), endDate: d(end) }, select: { id: true } })).id);
      }
    });
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
  });

  async function riskOf(id: string) {
    return withTenant(schoolId, async (db) => (await computeFeeRisks(db, schoolId, termIds[3]!, [id], TODAY)).get(id)!);
  }

  it("pays on time every term: Low", async () => {
    const s = await student("Ada");
    await invoice(s, 0, 100_000, [[100_000, "2025-05-01"]], "2025-05-15");
    await invoice(s, 1, 100_000, [[100_000, "2025-09-20"]], "2025-09-30");
    await invoice(s, 2, 100_000, [[100_000, "2026-01-30"]], "2026-01-31");
    await invoice(s, 3, 100_000, [], "2026-06-30");
    expect(await riskOf(s)).toEqual({ level: "LOW", reasons: [{ kind: "ON_TIME", of: 3 }] });
  });

  it("a payment on the due date itself is on time; a day later is late", async () => {
    const s = await student("Chidi");
    await invoice(s, 1, 100_000, [[100_000, "2025-09-30"]], "2025-09-30");
    await invoice(s, 2, 100_000, [[50_000, "2026-01-31"], [50_000, "2026-02-01"]], "2026-01-31");
    await invoice(s, 3, 100_000, [], "2026-06-30");
    const r = await riskOf(s);
    expect(r.level).toBe("WATCH");
    expect(r.reasons).toEqual([{ kind: "PAID_LATE", count: 1, of: 2 }]);
  });

  it("late twice and overdue now is High; a reversed payment does not count", async () => {
    const s = await student("Emeka");
    await invoice(s, 0, 100_000, [[100_000, "2025-06-10"]], "2025-05-15");
    await invoice(s, 1, 100_000, [[100_000, "2025-10-20"]], "2025-09-30");
    await invoice(s, 2, 100_000, [[100_000, "2026-01-10"]], "2026-01-31");
    await invoice(s, 3, 100_000, [[30_000, "2026-05-01"]], "2026-05-15");
    await withTenant(schoolId, (db) => db.payment.updateMany({ where: { schoolId, studentId: s, amount: 30_000 }, data: { status: "REVERSED" } }));
    const r = await riskOf(s);
    expect(r.level).toBe("HIGH");
    expect(r.reasons).toContainEqual({ kind: "PAID_LATE", count: 2, of: 3 });
    expect(r.reasons).toContainEqual({ kind: "OVERDUE_NOW", balance: 70_000 });
  });

  it("a balance on an earlier term (a supplementary invoice too) is High, named by term", async () => {
    const s = await student("Ngozi");
    await invoice(s, 1, 100_000, [[100_000, "2025-09-01"]], "2025-09-30");
    await invoice(s, 1, 20_000, [], "2025-11-30", 1);
    await invoice(s, 2, 100_000, [[55_000, "2026-01-10"]], "2026-01-31");
    await invoice(s, 3, 100_000, [], "2026-06-30");
    const r = await riskOf(s);
    expect(r.level).toBe("HIGH");
    expect(feeRiskSummary(r)).toBe(
      `₦450.00 still owing from Second Term 2025/2026-${runId}; ₦200.00 still owing from First Term 2025/2026-${runId}; Not paid in full by the due date in 1 of the last 2 terms`,
    );
  });

  it("a new student is Too new to say", async () => {
    const s = await student("Tobi");
    await invoice(s, 3, 100_000, [], "2026-06-30");
    expect((await riskOf(s)).level).toBe("TOO_NEW");
  });

  it("siblings are scored on their own, and say so when a brother or sister is Watch or High", async () => {
    const [a, b, c] = [await student("Uche"), await student("Kemi"), await student("Femi")];
    for (const s of [a, b, c]) await invoice(s, 2, 100_000, [[100_000, "2026-01-10"]], "2026-01-31");
    await invoice(a, 3, 100_000, [], "2026-05-15"); // overdue now → Watch
    await invoice(b, 3, 100_000, [], "2026-06-30");
    await invoice(c, 3, 100_000, [], "2026-06-30");
    await withTenant(schoolId, async (db) => {
      const mum = await db.guardian.create({ data: { schoolId, firstName: "Amaka", lastName: "Okafor", relationship: "MOTHER", phone: "+2348030000001" }, select: { id: true } });
      const other = await db.guardian.create({ data: { schoolId, firstName: "Sola", lastName: "Ade", relationship: "FATHER", phone: "+2348030000002" }, select: { id: true } });
      await db.studentGuardian.createMany({
        data: [
          { schoolId, studentId: a, guardianId: mum.id, isPrimary: true },
          { schoolId, studentId: b, guardianId: mum.id, isPrimary: true },
          // c's link to the same mother is not primary: not counted as a sibling.
          { schoolId, studentId: c, guardianId: mum.id, isPrimary: false },
          { schoolId, studentId: c, guardianId: other.id, isPrimary: true },
        ],
      });
    });
    const all = await withTenant(schoolId, (db) => computeFeeRisks(db, schoolId, termIds[3]!, [a, b, c], TODAY));
    expect(all.get(a)!.level).toBe("WATCH");
    expect(all.get(a)!.reasons.some((r) => r.kind === "SIBLING")).toBe(false);
    expect(all.get(b)!.level).toBe("LOW");
    expect(all.get(b)!.reasons).toContainEqual({ kind: "SIBLING", studentId: a, name: "Uche Okafor", level: "WATCH" });
    expect(all.get(c)!.reasons.some((r) => r.kind === "SIBLING")).toBe(false);
  });

  it("the debtor list carries each row's risk; the student read defaults to the current term; another school sees nothing", async () => {
    const s = await student("Zainab");
    await invoice(s, 2, 100_000, [[100_000, "2026-03-01"]], "2026-01-31");
    await invoice(s, 3, 100_000, [], "2099-06-30");
    await withTenant(schoolId, (db) => db.term.update({ where: { id: termIds[3] }, data: { isCurrent: true } }));
    const svc = new FinanceService({} as never, {} as never, {} as never, {} as never);
    const ctx = { sessionId: "s", userId: ownerId, schoolId };

    const rows = await svc.listDebtors(ctx, termIds[3]!);
    const row = rows.find((r) => r.studentId === s)!;
    expect(row.risk).toEqual({ level: "WATCH", reasons: [{ kind: "PAID_LATE", count: 1, of: 1 }] });
    expect(rows.every((r) => r.risk && r.risk.level)).toBe(true);

    expect(await svc.getStudentFeeRisk(ctx, s)).toEqual(row.risk);

    const other = await makeSchool("b");
    const otherCtx = { sessionId: "s", userId: other.ownerId, schoolId: other.schoolId };
    await expect(svc.getStudentFeeRisk(otherCtx, s)).rejects.toThrow(/not found/i);
    expect(await svc.listDebtors(otherCtx, termIds[3]!)).toEqual([]);
  });
});
