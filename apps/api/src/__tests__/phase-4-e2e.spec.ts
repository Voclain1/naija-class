import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError } from "@school-kit/types";

import { FilesystemStorageDriver } from "../common/storage/filesystem-storage.driver";
import { StorageService } from "../common/storage/storage.service";
import { PaymentPlanService } from "../modules/payments/payment-plan.service";
import { PaymentsService } from "../modules/payments/payments.service";
import { AuthService } from "../modules/auth/auth.service";
import { GuardiansService } from "../modules/guardians/guardians.service";
import { PortalAuthService } from "../modules/portal-auth/portal-auth.service";
import { PortalInvoicesService } from "../modules/portal-finance/portal-invoices.service";
import { PortalPaymentsService } from "../modules/portal-payments/portal-payments.service";
import { PortalStudentsService } from "../modules/portal-students/portal-students.service";

// Phase 4 / Slice 8 — the close-out E2E rollup, mirroring
// phase-2-e2e.spec.ts's own shape exactly (service-level, not browser; not
// a new coverage surface but a composed confirmation + the phase's
// canonical negative-walk artifact — see this slice's plan-first §4):
//   WALK 1 — the full guardian happy path composed end-to-end: invite ->
//            accept -> login -> view children -> view invoice -> pay.
//   WALK 2 — cross-tenant denial: a guardian at School B cannot touch
//            School A's guardian-facing data.
//   WALK 3 — cross-family denial WITHIN School A: a second family's
//            guardian cannot touch the first family's child's data — the
//            withGuardian() acceptance bar Decision B's own text names
//            explicitly (docs/modules/phase-4.md §3).
// Each walk builds its own ephemeral schools via signupOwner — no dev-seed.

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}
function guardianCtx(schoolId: string, guardianId: string) {
  return { sessionId: "sess", guardianId, schoolId };
}

const GUARDIAN_PASSWORD = "Correct-Horse-9";

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  return `+23495${(phoneCounter % 100).toString().padStart(2, "0")}${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
}

interface Roster {
  schoolId: string;
  ownerId: string;
  studentId: string;
  guardianId: string;
  guardianEmail: string;
  invoiceId: string;
  invoiceDue: number;
}

interface Fixture extends Roster {
  acceptUrl: string;
}

describe("Phase 4 E2E rollup (slice 8)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const guardians = new GuardiansService(
    { send: async () => undefined } as never,
    { sendSms: async () => undefined } as never,
    { getEnabledChannels: async () => ({ email: true, sms: false }) } as never,
  );
  const portalAuth = new PortalAuthService();
  const portalStudents = new PortalStudentsService();
  const portalInvoices = new PortalInvoicesService();

  // One shared Paystack stub across the whole file — verifyTransaction's
  // default (below) resolves "success" for every reference. That's a
  // deliberate simplification for this rollup (it's proving authorization
  // composition, not re-proving Slice 5's own success/failure branching,
  // which payments.service.spec.ts and portal-payments.controller.spec.ts
  // already cover in depth).
  const paystackStub = {
    initializeTransaction: async ({ reference }: { reference: string }) => ({
      authorization_url: `https://checkout.paystack.com/${reference}`,
      access_code: `ac_${reference}`,
      reference,
    }),
    verifyTransaction: async (reference: string) => ({
      status: "success",
      reference,
      amount: 0,
      paid_at: new Date().toISOString(),
    }),
  } as never;
  // WALK 1 exercises the real applyPaystackSuccess path (unlike WALK 2/3,
  // which are denied before ever reaching a successful verify), so
  // PaymentsService needs a genuinely working StorageService for its
  // receipt-generation step — same setup as phase-2-e2e.spec.ts's own
  // storageRoot.
  let storageRoot: string;
  let portalPayments: PortalPaymentsService;

  const schoolIds = new Set<string>();

  beforeAll(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "p4-e2e-"));
    const storage = new StorageService(new FilesystemStorageDriver(storageRoot));
    const paymentsService = new PaymentsService(storage, paystackStub, new PaymentPlanService());
    portalPayments = new PortalPaymentsService(paystackStub, paymentsService);
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
    await rm(storageRoot, { recursive: true, force: true });
  });

  // A school, one student, one guardian (real row, not yet invited), one
  // ISSUED invoice with a real balance.
  async function buildRoster(suffix: string): Promise<Roster> {
    const signed = await auth.signupOwner(
      {
        schoolName: `E2E4 ${suffix}`,
        schoolSlug: `e2e4-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `e2e4-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    const schoolId = signed.school.id;
    const ownerId = signed.user.id;
    schoolIds.add(schoolId);
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });

    const guardianEmail = `e2e4-guardian-${suffix}-${runId}@example.test`;
    const invoiceDue = 300_000_00;

    const { studentId, guardianId, invoiceId } = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `2025/2026-e2e4-${suffix}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        select: { id: true },
      });
      const student = await db.student.create({
        data: { schoolId, admissionNumber: `ADM-E2E4-${suffix}-${runId}`, firstName: "Stu", lastName: `Dent-${suffix}`, dateOfBirth: new Date("2015-01-01"), gender: "FEMALE" },
        select: { id: true },
      });
      const guardian = await db.guardian.create({
        data: { schoolId, firstName: "Gary", lastName: `Guardian-${suffix}`, relationship: "FATHER", phone: randomPhone(), email: guardianEmail },
        select: { id: true },
      });
      await db.studentGuardian.create({
        data: { schoolId, studentId: student.id, guardianId: guardian.id, isPrimary: true, canPickup: true },
      });
      const invoice = await db.invoice.create({
        data: {
          schoolId, studentId: student.id, termId: term.id, academicYearId: year.id,
          status: "ISSUED", items: [], totalAmount: invoiceDue, totalDiscount: 0,
          totalDue: invoiceDue, totalPaid: 0, issuedAt: new Date(),
        },
        select: { id: true },
      });
      return { studentId: student.id, guardianId: guardian.id, invoiceId: invoice.id };
    });

    return { schoolId, ownerId, studentId, guardianId, guardianEmail, invoiceId, invoiceDue };
  }

  // A second student+guardian+invoice seeded into an EXISTING school — used
  // by WALK 3 to build a second family alongside buildRoster's first,
  // without minting a second school (the whole point of that walk is two
  // families in the SAME tenant).
  async function addSecondFamily(
    schoolId: string,
    suffix: string,
  ): Promise<{ studentId: string; guardianId: string; guardianEmail: string; invoiceId: string; invoiceDue: number }> {
    const guardianEmail = `e2e4-guardian-${suffix}-${runId}@example.test`;
    const invoiceDue = 150_000_00;
    return withTenant(schoolId, async (db) => {
      const { termId, academicYearId } = await db.invoice.findFirstOrThrow({
        where: { schoolId },
        select: { termId: true, academicYearId: true },
      });
      const student = await db.student.create({
        data: { schoolId, admissionNumber: `ADM-E2E4-${suffix}-${runId}`, firstName: "Stu", lastName: `Dent-${suffix}`, dateOfBirth: new Date("2015-01-01"), gender: "MALE" },
        select: { id: true },
      });
      const guardian = await db.guardian.create({
        data: { schoolId, firstName: "Gina", lastName: `Guardian-${suffix}`, relationship: "MOTHER", phone: randomPhone(), email: guardianEmail },
        select: { id: true },
      });
      await db.studentGuardian.create({
        data: { schoolId, studentId: student.id, guardianId: guardian.id, isPrimary: true, canPickup: true },
      });
      const invoice = await db.invoice.create({
        data: {
          schoolId, studentId: student.id, termId, academicYearId,
          status: "ISSUED", items: [], totalAmount: invoiceDue, totalDiscount: 0,
          totalDue: invoiceDue, totalPaid: 0, issuedAt: new Date(),
        },
        select: { id: true },
      });
      return { studentId: student.id, guardianId: guardian.id, guardianEmail, invoiceId: invoice.id, invoiceDue };
    });
  }

  // Admin invites, guardian accepts — the two steps every fixture needs a
  // genuinely working, logged-in-capable guardian for. Returns the raw
  // invite response too, so WALK 1 (which cares about proving these two
  // steps, not just using their result) can assert on it directly.
  async function inviteAndAccept(schoolId: string, ownerId: string, guardianId: string) {
    const invited = await guardians.invite(ctx(schoolId, ownerId), guardianId, reqCtx);
    const rawToken = invited.acceptUrl.split("/invitations/")[1];
    const accepted = await portalAuth.acceptInvitation(
      rawToken,
      { password: GUARDIAN_PASSWORD, ndprConsent: true },
      reqCtx,
    );
    return { invited, accepted };
  }

  async function buildFixture(suffix: string): Promise<Fixture> {
    const roster = await buildRoster(suffix);
    const { invited } = await inviteAndAccept(roster.schoolId, roster.ownerId, roster.guardianId);
    return { ...roster, acceptUrl: invited.acceptUrl };
  }

  // =========================================================================
  // WALK 1 — critical path: invite -> accept -> login -> view children ->
  //          view invoice -> pay, composed end-to-end through every real
  //          Phase 4 surface.
  // =========================================================================
  it("WALK 1: the guardian journey composes end-to-end through every Phase 4 surface", async () => {
    const r = await buildRoster("w1");

    // 1. Admin invites the guardian.
    const invited = await guardians.invite(ctx(r.schoolId, r.ownerId), r.guardianId, reqCtx);
    expect(invited.acceptUrl).toContain("/invitations/");
    const rawToken = invited.acceptUrl.split("/invitations/")[1];

    // 2. Guardian accepts — sets password, mints a session.
    const accepted = await portalAuth.acceptInvitation(
      rawToken,
      { password: GUARDIAN_PASSWORD, ndprConsent: true },
      reqCtx,
    );
    expect(accepted.guardian.id).toBe(r.guardianId);

    // 3. Guardian logs in (a later, independent session — not the one
    // accept already minted).
    const loggedIn = await portalAuth.login({ email: r.guardianEmail, password: GUARDIAN_PASSWORD }, reqCtx);
    expect(loggedIn.guardian.id).toBe(r.guardianId);
    const gCtx = guardianCtx(r.schoolId, r.guardianId);

    // 4. Guardian views their children.
    const children = await portalStudents.list(gCtx);
    expect(children.data.map((c) => c.id)).toEqual([r.studentId]);

    // 5. Guardian views one child's detail.
    const child = await portalStudents.findById(gCtx, r.studentId);
    expect(child.id).toBe(r.studentId);

    // 6. Guardian views that child's invoices.
    const invoices = await portalInvoices.listForStudent(gCtx, r.studentId);
    expect(invoices.data).toHaveLength(1);
    expect(invoices.data[0].id).toBe(r.invoiceId);
    expect(invoices.data[0].totalDue).toBe(r.invoiceDue);

    // 7. Guardian pays — server-computed exact balance.
    const init = await portalPayments.initiate(gCtx, r.studentId, r.invoiceId, reqCtx);
    expect(init.reference).toContain(r.schoolId);

    // 8. Guardian's callback-page poll actively verifies against Paystack
    // (stubbed "success") and applies the result.
    const verified = await portalPayments.verify(gCtx, init.reference);
    expect(verified.status).toBe("SUCCESS");

    const invoiceAfter = await withTenant(r.schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: r.invoiceId }, select: { totalPaid: true, status: true } }),
    );
    expect(invoiceAfter.totalPaid).toBe(r.invoiceDue);
    expect(invoiceAfter.status).toBe("PAID");
  });

  // =========================================================================
  // WALK 2 — cross-tenant denial: School B's guardian cannot touch School
  //          A's guardian-facing data.
  // =========================================================================
  it("WALK 2: a second school's guardian cannot read or write the first school's guardian-facing data", async () => {
    const a = await buildFixture("w2a");
    const b = await buildFixture("w2b");
    const bCtx = guardianCtx(b.schoolId, b.guardianId); // School B guardian acting on School A ids

    // list() filters by the caller's own guardianId — never errors, just
    // never contains A's student (same "filter, not exception" shape
    // phase-2-e2e's WALK 2 documents for getFeed/getRegister).
    const children = await portalStudents.list(bCtx);
    expect(children.data.map((c) => c.id)).not.toContain(a.studentId);

    // findById takes a caller-supplied studentId → withGuardian → Forbidden.
    await expect(portalStudents.findById(bCtx, a.studentId)).rejects.toBeInstanceOf(ForbiddenError);

    // Invoice listing — same withGuardian composition.
    await expect(portalInvoices.listForStudent(bCtx, a.studentId)).rejects.toBeInstanceOf(ForbiddenError);

    // Payment initiation — withGuardian runs before any invoice/amount logic.
    await expect(
      portalPayments.initiate(bCtx, a.studentId, a.invoiceId, reqCtx),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const leakedPayments = await withTenant(a.schoolId, (db) =>
      db.payment.count({ where: { invoiceId: a.invoiceId } }),
    );
    expect(leakedPayments).toBe(0);

    // Payment verify — A's guardian pays for real first, producing a real
    // reference (PSK-{A's schoolId}-{paymentId}); B's guardian then tries
    // to poll it. The schoolId embedded in the reference itself is checked
    // BEFORE any withGuardian call, so this is a NotFoundError (the
    // reference doesn't even parse as belonging to B's tenant), not a
    // ForbiddenError — a distinct defense layer from the studentId-based
    // checks above, both proven here rather than assumed.
    const aCtx = guardianCtx(a.schoolId, a.guardianId);
    const aInit = await portalPayments.initiate(aCtx, a.studentId, a.invoiceId, reqCtx);
    await expect(portalPayments.verify(bCtx, aInit.reference)).rejects.toBeInstanceOf(NotFoundError);
    const aInvoiceAfter = await withTenant(a.schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: a.invoiceId }, select: { totalPaid: true } }),
    );
    expect(aInvoiceAfter.totalPaid).toBe(0);
  });

  // =========================================================================
  // WALK 3 — cross-family denial WITHIN the same school: a second family's
  //          guardian cannot touch the first family's child's data. This is
  //          the leak RLS alone does not prevent (both families share
  //          school_id) — Decision B's own acceptance bar.
  // =========================================================================
  it("WALK 3: a second family's guardian (same school) cannot read or write the first family's child's data", async () => {
    const a1 = await buildFixture("w3a1");
    const a2 = await addSecondFamily(a1.schoolId, "w3a2");
    await inviteAndAccept(a1.schoolId, a1.ownerId, a2.guardianId);
    const a2Ctx = guardianCtx(a1.schoolId, a2.guardianId); // family 2's guardian acting on family 1's ids

    const children = await portalStudents.list(a2Ctx);
    expect(children.data.map((c) => c.id)).not.toContain(a1.studentId);

    await expect(portalStudents.findById(a2Ctx, a1.studentId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(portalInvoices.listForStudent(a2Ctx, a1.studentId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      portalPayments.initiate(a2Ctx, a1.studentId, a1.invoiceId, reqCtx),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const leakedPayments = await withTenant(a1.schoolId, (db) =>
      db.payment.count({ where: { invoiceId: a1.invoiceId } }),
    );
    expect(leakedPayments).toBe(0);

    // Payment verify — SAME school this time, so the reference's embedded
    // schoolId matches a2Ctx.schoolId; the denial comes from withGuardian
    // (studentId link), not the reference-parse check — proving the two
    // defense layers are independently correct, not that one happens to
    // cover for a gap in the other.
    const a1Ctx = guardianCtx(a1.schoolId, a1.guardianId);
    const a1Init = await portalPayments.initiate(a1Ctx, a1.studentId, a1.invoiceId, reqCtx);
    await expect(portalPayments.verify(a2Ctx, a1Init.reference)).rejects.toBeInstanceOf(ForbiddenError);
    const a1InvoiceAfter = await withTenant(a1.schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: a1.invoiceId }, select: { totalPaid: true } }),
    );
    expect(a1InvoiceAfter.totalPaid).toBe(0);
  });
});
