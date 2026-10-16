import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { InvoiceGenerationService } from "../invoices/invoice-generation.service";
import { StudentChargeService } from "./student-charge.service";

// Phase 9 / CP5.1 — student charges (F2) and supplementary invoices
// (docs/modules/phase-9.md §13), against real Postgres. Money first: what a
// charge adds to an invoice, that no charge is ever billed twice, that a
// billed amount never changes, and who may touch any of it.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TUITION = 15_000_000; // ₦150,000

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

async function makeSchool(label: string) {
  const signed = await new AuthService().signupOwner(
    {
      schoolName: `Charges ${label} ${runId}`,
      schoolSlug: `charges-${label}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `charges-${label}-${runId}@example.test`,
      ownerPhone: `+23496${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
  return { schoolId: signed.school.id, ownerId: signed.user.id };
}

interface Fixture {
  schoolId: string;
  ownerId: string;
  adminId: string;
  bursarId: string;
  teacherId: string;
  yearId: string;
  termId: string;
  nextTermId: string;
  armId: string;
  feeCategoryId: string;
}

describe("StudentChargeService and supplementary invoices (integration)", () => {
  const charges = new StudentChargeService();
  const invoices = new InvoiceGenerationService(undefined, charges);
  const schoolIds = new Set<string>();
  let A: Fixture;
  let B: Fixture;
  let studentCounter = 0;

  async function setUp(label: string): Promise<Fixture> {
    const s = await makeSchool(label);
    schoolIds.add(s.schoolId);
    const schoolId = s.schoolId;
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: day("2026-09-01"), endDate: day("2027-07-31") },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: day("2026-09-01"), endDate: day("2026-12-11"), isCurrent: true },
      });
      const nextTerm = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 2, name: "Second Term", startDate: day("2027-01-05"), endDate: day("2027-04-01") },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `ch-${label}-${runId}` } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staff = async (key: string) => {
        const user = await db.user.create({ data: { schoolId, email: `ch-${label}-${key}-${runId}@example.test`, firstName: key, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(key) } });
        return user.id;
      };
      const cat = await db.feeCategory.create({ data: { schoolId, name: "Tuition", createdBy: s.ownerId } });
      await db.feeItem.create({
        data: { schoolId, categoryId: cat.id, name: "Term tuition", amount: TUITION, classLevelId: level.id, createdBy: s.ownerId },
      });
      // A whole-category discount: it must never reach a charge line.
      return {
        schoolId,
        ownerId: s.ownerId,
        adminId: await staff("admin"),
        bursarId: await staff("bursar"),
        teacherId: await staff("teacher"),
        yearId: year.id,
        termId: term.id,
        nextTermId: nextTerm.id,
        armId: arm.id,
        feeCategoryId: cat.id,
      };
    });
  }

  async function student(f: Fixture, terms: string[] = [f.termId]): Promise<string> {
    studentCounter += 1;
    return withTenant(f.schoolId, async (db) => {
      const s = await db.student.create({
        data: { schoolId: f.schoolId, admissionNumber: `CH-${studentCounter}-${runId}`, firstName: "Ada", lastName: `Pupil${studentCounter}`, dateOfBirth: day("2013-01-01"), gender: "FEMALE" },
      });
      for (const termId of terms) {
        await db.enrollment.create({ data: { schoolId: f.schoolId, studentId: s.id, termId, academicYearId: f.yearId, classArmId: f.armId, status: "ENROLLED" } });
      }
      return s.id;
    });
  }

  // Only the one student's invoices, so tests in the same arm don't collide.
  async function invoicesOf(f: Fixture, studentId: string) {
    return withTenant(f.schoolId, (db) =>
      db.invoice.findMany({ where: { studentId }, orderBy: { sequence: "asc" } }),
    );
  }

  async function chargeRow(f: Fixture, id: string) {
    return withTenant(f.schoolId, (db) => db.studentCharge.findUniqueOrThrow({ where: { id } }));
  }

  async function generate(f: Fixture) {
    return invoices.generateForArm(ctx(f.schoolId, f.bursarId), { termId: f.termId, classArmId: f.armId }, reqCtx);
  }

  async function raiseBy(f: Fixture, studentId: string, amount: number, termId = f.termId) {
    return charges.raiseByHand(ctx(f.schoolId, f.bursarId), { studentId, termId, description: "Excursion to Badagry", amount }, reqCtx);
  }

  async function auditActions(f: Fixture, entityId: string) {
    return withTenant(f.schoolId, async (db) =>
      (await db.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: "asc" }, select: { action: true, metadata: true } })),
    );
  }

  beforeAll(async () => {
    A = await setUp("a");
    B = await setUp("b");
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  // ── Adding and voiding by hand ───────────────────────────────────────────

  describe("adding a charge by hand", () => {
    it("raises an OPEN OTHER charge, audited with the amount and ids only", async () => {
      const kid = await student(A);
      const charge = await raiseBy(A, kid, 500_000);
      expect(charge).toMatchObject({ studentId: kid, termId: A.termId, kind: "OTHER", amount: 500_000, status: "OPEN", invoiceId: null, sourceModule: null });
      const audit = await auditActions(A, charge.id);
      expect(audit.map((a) => a.action)).toEqual(["charge.raise"]);
      expect(audit[0]!.metadata).toMatchObject({ studentId: kid, termId: A.termId, kind: "OTHER", amount: 500_000 });
      expect(JSON.stringify(audit[0]!.metadata)).not.toContain("Badagry");
    });

    it("is open to owner, admin and bursar, and refused to a teacher", async () => {
      const kid = await student(A);
      for (const userId of [A.ownerId, A.adminId, A.bursarId]) {
        const c = await charges.raiseByHand(ctx(A.schoolId, userId), { studentId: kid, termId: A.termId, description: "Lab coat", amount: 100 }, reqCtx);
        expect(c.status).toBe("OPEN");
      }
      await expect(
        charges.raiseByHand(ctx(A.schoolId, A.teacherId), { studentId: kid, termId: A.termId, description: "Lab coat", amount: 100 }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(charges.list(ctx(A.schoolId, A.teacherId), { studentId: kid })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("refuses another school's student or term", async () => {
      const theirs = await student(B);
      await expect(raiseBy(A, theirs, 100)).rejects.toBeInstanceOf(NotFoundError);
      const kid = await student(A);
      await expect(raiseBy(A, kid, 100, B.termId)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("lists a class's students for the term with their charges", async () => {
      const f = await setUp(`l${studentCounter}`);
      const kid = await student(f);
      const other = await student(f);
      await charges.raiseByHand(ctx(f.schoolId, f.bursarId), { studentId: kid, termId: f.termId, description: "Trip", amount: 3 }, reqCtx);
      await charges.raiseByHand(ctx(f.schoolId, f.bursarId), { studentId: kid, termId: f.nextTermId, description: "Later", amount: 4 }, reqCtx);
      const rows = await charges.listForArm(ctx(f.schoolId, f.bursarId), { termId: f.termId, classArmId: f.armId });
      expect(rows.map((r) => r.studentId).sort()).toEqual([kid, other].sort());
      expect(rows.find((r) => r.studentId === kid)!.charges.map((c) => c.amount)).toEqual([3]);
      expect(rows.find((r) => r.studentId === other)!.charges).toEqual([]);
      await expect(charges.listForArm(ctx(f.schoolId, f.teacherId), { termId: f.termId, classArmId: f.armId })).rejects.toBeInstanceOf(ForbiddenError);
      expect(await charges.listForArm(ctx(B.schoolId, B.bursarId), { termId: f.termId, classArmId: f.armId })).toEqual([]);
    });

    it("another school cannot list or void it (RLS)", async () => {
      const kid = await student(A);
      const charge = await raiseBy(A, kid, 100);
      expect(await charges.list(ctx(B.schoolId, B.bursarId), { studentId: kid })).toEqual([]);
      await expect(
        charges.voidCharge(ctx(B.schoolId, B.bursarId), charge.id, { reason: "x" }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("voids an OPEN charge with a reason, audited, and lists it as VOID", async () => {
      const kid = await student(A);
      const charge = await raiseBy(A, kid, 700);
      const voided = await charges.voidCharge(ctx(A.schoolId, A.adminId), charge.id, { reason: "Raised in error" }, reqCtx);
      expect(voided).toMatchObject({ status: "VOID", voidReason: "Raised in error" });
      expect((await auditActions(A, charge.id)).map((a) => a.action)).toEqual(["charge.raise", "charge.void"]);
      const listed = await charges.list(ctx(A.schoolId, A.bursarId), { studentId: kid });
      expect(listed.map((c) => c.status)).toEqual(["VOID"]);
      await expect(
        charges.voidCharge(ctx(A.schoolId, A.adminId), charge.id, { reason: "Again" }, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("a teacher cannot void", async () => {
      const kid = await student(A);
      const charge = await raiseBy(A, kid, 700);
      await expect(
        charges.voidCharge(ctx(A.schoolId, A.teacherId), charge.id, { reason: "x" }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  // ── The term invoice picks charges up ────────────────────────────────────

  describe("generating the term invoice", () => {
    it("adds the student's OPEN charges for the term as lines, after the fee items, and bills them", async () => {
      const kid = await student(A);
      const other = await student(A);
      const mine = await raiseBy(A, kid, 2_500_000);
      const nextTerm = await raiseBy(A, kid, 999, A.nextTermId);
      const theirs = await raiseBy(A, other, 1_234);
      const voided = await raiseBy(A, kid, 4_444);
      await charges.voidCharge(ctx(A.schoolId, A.bursarId), voided.id, { reason: "No" }, reqCtx);

      await generate(A);
      const [inv] = await invoicesOf(A, kid);
      expect(inv!.sequence).toBe(0);
      expect(inv!.totalAmount).toBe(TUITION + 2_500_000);
      expect(inv!.totalDue).toBe(TUITION + 2_500_000);
      const items = inv!.items as Array<Record<string, unknown>>;
      expect(items).toHaveLength(2);
      expect(items[1]).toMatchObject({
        chargeId: mine.id,
        feeItemId: null,
        categoryName: "Other charges",
        feeName: "Excursion to Badagry",
        amount: 2_500_000,
        netAmount: 2_500_000,
        discountsApplied: [],
      });

      expect(await chargeRow(A, mine.id)).toMatchObject({ status: "BILLED", invoiceId: inv!.id });
      expect(await chargeRow(A, nextTerm.id)).toMatchObject({ status: "OPEN", invoiceId: null });
      expect(await chargeRow(A, voided.id)).toMatchObject({ status: "VOID", invoiceId: null });
      const [otherInv] = await invoicesOf(A, other);
      expect(await chargeRow(A, theirs.id)).toMatchObject({ status: "BILLED", invoiceId: otherInv!.id });
      expect(otherInv!.totalAmount).toBe(TUITION + 1_234);
      expect((await auditActions(A, mine.id)).map((a) => a.action)).toEqual(["charge.raise", "charge.bill"]);
    });

    it("never applies a discount to a charge line", async () => {
      const kid = await student(A);
      await withTenant(A.schoolId, (db) =>
        db.discountRule.create({
          data: { schoolId: A.schoolId, studentId: kid, name: "Staff child", feeCategoryId: A.feeCategoryId, discountType: "FULL_WAIVER", duration: "LIFETIME", createdBy: A.ownerId },
        }),
      );
      await raiseBy(A, kid, 300_000);
      await generate(A);
      const [inv] = await invoicesOf(A, kid);
      expect(inv!.totalAmount).toBe(TUITION + 300_000);
      expect(inv!.totalDiscount).toBe(TUITION);
      expect(inv!.totalDue).toBe(300_000);
    });

    it("the preview shows the charges and the same totals generation then issues", async () => {
      const kid = await student(A);
      await raiseBy(A, kid, 50_000);
      await raiseBy(A, kid, 25_000);
      const preview = await invoices.previewForArm(ctx(A.schoolId, A.bursarId), { termId: A.termId, classArmId: A.armId });
      const line = preview.find((p) => p.studentId === kid)!;
      expect(line).toMatchObject({ chargeCount: 2, totalAmount: TUITION + 75_000, totalDue: TUITION + 75_000, alreadyInvoiced: false });
      await generate(A);
      const [inv] = await invoicesOf(A, kid);
      expect(inv!.totalDue).toBe(line.totalDue);
    });

    it("a second run bills nothing twice and leaves later charges waiting", async () => {
      const kid = await student(A);
      await raiseBy(A, kid, 10_000);
      await generate(A);
      const late = await raiseBy(A, kid, 20_000);
      await generate(A);
      const all = await invoicesOf(A, kid);
      expect(all).toHaveLength(1);
      expect(all[0]!.totalAmount).toBe(TUITION + 10_000);
      expect(await chargeRow(A, late.id)).toMatchObject({ status: "OPEN" });
    });

    it("markBilled refuses a charge that is no longer OPEN, so two runs can never bill it twice", async () => {
      const kid = await student(A);
      const charge = await raiseBy(A, kid, 10_000);
      await generate(A);
      const [inv] = await invoicesOf(A, kid);
      await expect(
        withTenant(A.schoolId, (db) =>
          charges.markBilled(db, { schoolId: A.schoolId, userId: A.bursarId, ipAddress: null }, [charge.id], inv!.id),
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  // ── Supplementary invoices ───────────────────────────────────────────────

  describe("billing waiting charges", () => {
    it("issues one supplementary invoice per student with a term invoice, holding exactly their OPEN charges", async () => {
      const f = await setUp(`s${studentCounter}`);
      const invoiced = await student(f);
      const notYet = await student(f);
      await invoices.generateForArm(ctx(f.schoolId, f.bursarId), { termId: f.termId, classArmId: f.armId }, reqCtx);
      // notYet joins the arm after the run, so has no term invoice.
      const lateKid = notYet;
      await withTenant(f.schoolId, (db) => db.invoice.deleteMany({ where: { studentId: lateKid } }));

      const c1 = await charges.raiseByHand(ctx(f.schoolId, f.bursarId), { studentId: invoiced, termId: f.termId, description: "Bus", amount: 40_000 }, reqCtx);
      const c2 = await charges.raiseByHand(ctx(f.schoolId, f.bursarId), { studentId: invoiced, termId: f.termId, description: "Trip", amount: 2_000 }, reqCtx);
      await charges.raiseByHand(ctx(f.schoolId, f.bursarId), { studentId: invoiced, termId: f.nextTermId, description: "Next term", amount: 9 }, reqCtx);
      const waiting = await charges.raiseByHand(ctx(f.schoolId, f.bursarId), { studentId: lateKid, termId: f.termId, description: "Bus", amount: 40_000 }, reqCtx);

      const preview = await invoices.previewWaitingCharges(ctx(f.schoolId, f.bursarId), { termId: f.termId });
      expect(preview.toBill).toHaveLength(1);
      expect(preview.toBill[0]).toMatchObject({ studentId: invoiced, chargeCount: 2, total: 42_000 });
      expect(preview.totalToBill).toBe(42_000);
      expect(preview.waitingForTermInvoice).toBe(1);

      const result = await invoices.billWaitingCharges(ctx(f.schoolId, f.bursarId), { termId: f.termId, dueDate: "2026-11-30" }, reqCtx);
      expect(result).toEqual({ created: 1, chargesBilled: 2, total: 42_000 });

      const all = await invoicesOf(f, invoiced);
      expect(all.map((i) => i.sequence)).toEqual([0, 1]);
      const supp = all[1]!;
      expect(supp).toMatchObject({ status: "ISSUED", totalAmount: 42_000, totalDiscount: 0, totalDue: 42_000, classArmId: f.armId });
      expect(supp.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-30");
      expect((supp.items as Array<{ chargeId: string }>).map((i) => i.chargeId).sort()).toEqual([c1.id, c2.id].sort());
      expect(await chargeRow(f, c1.id)).toMatchObject({ status: "BILLED", invoiceId: supp.id });
      expect(await chargeRow(f, waiting.id)).toMatchObject({ status: "OPEN" });

      const dto = await invoices.findById(ctx(f.schoolId, f.bursarId), supp.id);
      expect(dto).toMatchObject({ sequence: 1, kind: "SUPPLEMENTARY" });
      expect((await auditActions(f, supp.id)).map((a) => a.action)).toEqual(["invoice.issue"]);

      // Nothing left: a second press issues nothing.
      expect(await invoices.billWaitingCharges(ctx(f.schoolId, f.bursarId), { termId: f.termId }, reqCtx)).toEqual({ created: 0, chargesBilled: 0, total: 0 });

      // A later charge gets the next number.
      await charges.raiseByHand(ctx(f.schoolId, f.bursarId), { studentId: invoiced, termId: f.termId, description: "Bus again", amount: 1 }, reqCtx);
      await invoices.billWaitingCharges(ctx(f.schoolId, f.bursarId), { termId: f.termId }, reqCtx);
      expect((await invoicesOf(f, invoiced)).map((i) => i.sequence)).toEqual([0, 1, 2]);

      // The waiting student's charge rides on their term invoice when it comes.
      await invoices.generateForArm(ctx(f.schoolId, f.bursarId), { termId: f.termId, classArmId: f.armId }, reqCtx);
      const [termInv] = await invoicesOf(f, lateKid);
      expect(termInv!.totalAmount).toBe(TUITION + 40_000);
    });

    it("bills a student whose term invoice was cancelled", async () => {
      const f = await setUp(`c${studentCounter}`);
      const kid = await student(f);
      await invoices.generateForArm(ctx(f.schoolId, f.bursarId), { termId: f.termId, classArmId: f.armId }, reqCtx);
      const [termInv] = await invoicesOf(f, kid);
      await invoices.cancel(ctx(f.schoolId, f.bursarId), termInv!.id, reqCtx);
      await charges.raiseByHand(ctx(f.schoolId, f.bursarId), { studentId: kid, termId: f.termId, description: "Bus", amount: 5 }, reqCtx);
      expect((await invoices.billWaitingCharges(ctx(f.schoolId, f.bursarId), { termId: f.termId }, reqCtx)).created).toBe(1);
    });

    it("two presses at once bill each charge exactly once", async () => {
      const f = await setUp(`r${studentCounter}`);
      const kid = await student(f);
      await invoices.generateForArm(ctx(f.schoolId, f.bursarId), { termId: f.termId, classArmId: f.armId }, reqCtx);
      const charge = await charges.raiseByHand(ctx(f.schoolId, f.bursarId), { studentId: kid, termId: f.termId, description: "Bus", amount: 40_000 }, reqCtx);
      const results = await Promise.allSettled([
        invoices.billWaitingCharges(ctx(f.schoolId, f.bursarId), { termId: f.termId }, reqCtx),
        invoices.billWaitingCharges(ctx(f.schoolId, f.adminId), { termId: f.termId }, reqCtx),
      ]);
      const created = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.created] : []));
      expect(created.reduce((a, b) => a + b, 0)).toBe(1);
      const all = await invoicesOf(f, kid);
      expect(all.map((i) => i.sequence)).toEqual([0, 1]);
      expect(await chargeRow(f, charge.id)).toMatchObject({ status: "BILLED", invoiceId: all[1]!.id });
    });

    it("is refused to a teacher", async () => {
      await expect(invoices.previewWaitingCharges(ctx(A.schoolId, A.teacherId), { termId: A.termId })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(invoices.billWaitingCharges(ctx(A.schoolId, A.teacherId), { termId: A.termId }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("the database allows one TERM invoice per student per term, and any number of supplementary ones", async () => {
      const kid = await student(A);
      const base = { schoolId: A.schoolId, studentId: kid, termId: A.termId, academicYearId: A.yearId, items: [], totalAmount: 0, totalDiscount: 0, totalDue: 0 };
      await withTenant(A.schoolId, async (db) => {
        await db.invoice.create({ data: { ...base, sequence: 0 } });
        await db.invoice.create({ data: { ...base, sequence: 1 } });
        await db.invoice.create({ data: { ...base, sequence: 2 } });
      });
      await expect(withTenant(A.schoolId, (db) => db.invoice.create({ data: { ...base, sequence: 0 } }))).rejects.toThrow();
      await expect(withTenant(A.schoolId, (db) => db.invoice.create({ data: { ...base, sequence: -1 } }))).rejects.toThrow();
    });
  });

  // ── Billed charges never change ──────────────────────────────────────────

  describe("after billing", () => {
    it("a billed charge cannot be voided", async () => {
      const kid = await student(A);
      const charge = await raiseBy(A, kid, 10);
      await generate(A);
      await expect(
        charges.voidCharge(ctx(A.schoolId, A.bursarId), charge.id, { reason: "Too late" }, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("cancelling an unpaid invoice returns its charges to OPEN, audited", async () => {
      const kid = await student(A);
      const charge = await raiseBy(A, kid, 10);
      await generate(A);
      const [inv] = await invoicesOf(A, kid);
      await invoices.cancel(ctx(A.schoolId, A.bursarId), inv!.id, reqCtx);
      expect(await chargeRow(A, charge.id)).toMatchObject({ status: "OPEN", invoiceId: null });
      expect((await auditActions(A, charge.id)).map((a) => a.action)).toEqual(["charge.raise", "charge.bill", "charge.release"]);
      // …where it can be voided, or billed again on a supplementary invoice.
      const result = await invoices.billWaitingCharges(ctx(A.schoolId, A.bursarId), { termId: A.termId }, reqCtx);
      expect(result.chargesBilled).toBeGreaterThanOrEqual(1);
      expect((await chargeRow(A, charge.id)).status).toBe("BILLED");
    });

    it("re-pricing and voiding by source touch only an OPEN charge", async () => {
      const kid = await student(A);
      const actor = { schoolId: A.schoolId, userId: A.adminId, ipAddress: null };
      const source = { sourceModule: "transport", sourceId: `assign-${runId}-${kid}` };
      const raised = await withTenant(A.schoolId, (db) =>
        charges.raise(db, actor, { studentId: kid, termId: A.termId, kind: "TRANSPORT", description: "Transport — Route A", amount: 30_000, ...source }),
      );
      expect(raised).toMatchObject({ kind: "TRANSPORT", sourceModule: "transport", status: "OPEN" });

      // One live charge per source.
      await expect(
        withTenant(A.schoolId, (db) =>
          charges.raise(db, actor, { studentId: kid, termId: A.termId, kind: "TRANSPORT", description: "Again", amount: 1, ...source }),
        ),
      ).rejects.toBeInstanceOf(ConflictError);

      expect(await withTenant(A.schoolId, (db) => charges.reprice(db, actor, { ...source, amount: 35_000, description: "Transport — Route B" }))).toBe("repriced");
      expect(await chargeRow(A, raised.id)).toMatchObject({ amount: 35_000, description: "Transport — Route B" });

      await generate(A);
      expect(await withTenant(A.schoolId, (db) => charges.reprice(db, actor, { ...source, amount: 1 }))).toBe("billed");
      expect(await withTenant(A.schoolId, (db) => charges.voidBySource(db, actor, { ...source, reason: "Left the route" }))).toBe("billed");
      expect(await chargeRow(A, raised.id)).toMatchObject({ amount: 35_000, status: "BILLED" });
      const [inv] = await invoicesOf(A, kid);
      expect(inv!.totalAmount).toBe(TUITION + 35_000);

      const none = { sourceModule: "transport", sourceId: `nothing-${runId}` };
      expect(await withTenant(A.schoolId, (db) => charges.voidBySource(db, actor, { ...none, reason: "x" }))).toBe("none");
      expect((await auditActions(A, raised.id)).map((a) => a.action)).toEqual(["charge.raise", "charge.reprice", "charge.bill"]);
    });

    it("voidBySource voids an OPEN charge and frees the source for a new one", async () => {
      const kid = await student(A);
      const actor = { schoolId: A.schoolId, userId: A.adminId, ipAddress: null };
      const source = { sourceModule: "transport", sourceId: `free-${runId}-${kid}` };
      const first = await withTenant(A.schoolId, (db) =>
        charges.raise(db, actor, { studentId: kid, termId: A.termId, kind: "TRANSPORT", description: "Bus", amount: 5, ...source }),
      );
      expect(await withTenant(A.schoolId, (db) => charges.voidBySource(db, actor, { ...source, reason: "Removed from route" }))).toBe("voided");
      expect(await chargeRow(A, first.id)).toMatchObject({ status: "VOID", voidReason: "Removed from route" });
      const second = await withTenant(A.schoolId, (db) =>
        charges.raise(db, actor, { studentId: kid, termId: A.termId, kind: "TRANSPORT", description: "Bus", amount: 5, ...source }),
      );
      expect(second.status).toBe("OPEN");
    });

    it("the database refuses a BILLED charge with no invoice and a VOID one with no reason", async () => {
      const kid = await student(A);
      const charge = await raiseBy(A, kid, 10);
      await expect(withTenant(A.schoolId, (db) => db.studentCharge.update({ where: { id: charge.id }, data: { status: "BILLED" } }))).rejects.toThrow();
      await expect(withTenant(A.schoolId, (db) => db.studentCharge.update({ where: { id: charge.id }, data: { status: "VOID" } }))).rejects.toThrow();
      await expect(withTenant(A.schoolId, (db) => db.studentCharge.update({ where: { id: charge.id }, data: { amount: 0 } }))).rejects.toThrow();
    });
  });
});
