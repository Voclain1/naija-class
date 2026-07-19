import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { basePrisma, withTenant } from "@school-kit/db";

import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { createGuardianSession } from "../../common/auth/guardian-sessions";
import { PortalFinanceModule } from "./portal-finance.module";

// Phase 4 / Slice 4 — invoices reuse the exact withTenant + withGuardian()
// composition Slice 3 already proved (see portal-students.controller.spec
// .ts for the mechanism's own full negative-walk coverage). This suite
// confirms it holds for a new resource type, plus invoice-specific
// behaviour: correct item content, a child with zero invoices returning an
// empty list not an error, and an exact response-shape assertion so a
// future mapping bug can't leak schoolId/issuedBy back in (same discipline
// added to portal-students' spec after review).

describe("PortalInvoicesController (Phase 4 / Slice 4)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const schoolIdsToCleanup = new Set<string>();
  let app: INestApplication;

  let schoolA: string;
  let schoolB: string;
  let guardianA1: string; // linked to studentA1, which HAS an invoice
  let guardianA2: string; // linked to studentA2, which has NO invoices
  let guardianB1: string; // school B
  let studentA1: string;
  let studentA2: string;
  let studentB1: string;
  let invoiceA1: string;
  let termA1Id: string;
  let termA1Name: string;
  let tokenA1: string;
  let tokenA2: string;
  let tokenB1: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PortalFinanceModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const schoolRowA = await basePrisma.school.create({
      data: { name: `Portal Invoices Spec A ${runId}`, slug: `portal-invoices-a-${runId}` },
      select: { id: true },
    });
    schoolA = schoolRowA.id;
    schoolIdsToCleanup.add(schoolA);

    const schoolRowB = await basePrisma.school.create({
      data: { name: `Portal Invoices Spec B ${runId}`, slug: `portal-invoices-b-${runId}` },
      select: { id: true },
    });
    schoolB = schoolRowB.id;
    schoolIdsToCleanup.add(schoolB);

    await withTenant(schoolA, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId: schoolA, label: `2025/2026-pinv-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      const term = await db.term.create({
        data: { schoolId: schoolA, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        select: { id: true, name: true, sequence: true },
      });
      termA1Id = term.id;
      termA1Name = term.name;

      const gA1 = await db.guardian.create({
        data: { schoolId: schoolA, firstName: "Ada", lastName: `GuardianA1-${runId}`, relationship: "MOTHER", phone: `+234802${runId}1` },
        select: { id: true },
      });
      const gA2 = await db.guardian.create({
        data: { schoolId: schoolA, firstName: "Bola", lastName: `GuardianA2-${runId}`, relationship: "FATHER", phone: `+234802${runId}2` },
        select: { id: true },
      });
      guardianA1 = gA1.id;
      guardianA2 = gA2.id;

      const sA1 = await db.student.create({
        data: { schoolId: schoolA, admissionNumber: `ADM-PI-A1-${runId}`, firstName: "Student", lastName: `A1-${runId}`, dateOfBirth: new Date("2015-01-01"), gender: "FEMALE" },
        select: { id: true },
      });
      const sA2 = await db.student.create({
        data: { schoolId: schoolA, admissionNumber: `ADM-PI-A2-${runId}`, firstName: "Student", lastName: `A2-${runId}`, dateOfBirth: new Date("2016-01-01"), gender: "MALE" },
        select: { id: true },
      });
      studentA1 = sA1.id;
      studentA2 = sA2.id;

      await db.studentGuardian.create({ data: { schoolId: schoolA, studentId: studentA1, guardianId: guardianA1, isPrimary: true, canPickup: true } });
      await db.studentGuardian.create({ data: { schoolId: schoolA, studentId: studentA2, guardianId: guardianA2, isPrimary: true, canPickup: true } });

      const inv = await db.invoice.create({
        data: {
          schoolId: schoolA,
          studentId: studentA1,
          termId: term.id,
          academicYearId: year.id,
          status: "ISSUED",
          items: [
            {
              feeItemId: "fi-1",
              categoryName: "Tuition",
              feeName: "Term 1 Tuition",
              amount: 500_000_00,
              discountsApplied: [],
              netAmount: 500_000_00,
            },
          ],
          totalAmount: 500_000_00,
          totalDiscount: 0,
          totalDue: 500_000_00,
          totalPaid: 0,
          dueDate: new Date("2025-10-01"),
          issuedAt: new Date(),
          issuedBy: null,
        },
        select: { id: true },
      });
      invoiceA1 = inv.id;
    });

    await withTenant(schoolB, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId: schoolB, label: `2025/2026-pinv-b-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      const term = await db.term.create({
        data: { schoolId: schoolB, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        select: { id: true },
      });

      const gB1 = await db.guardian.create({
        data: { schoolId: schoolB, firstName: "Dupe", lastName: `GuardianB1-${runId}`, relationship: "MOTHER", phone: `+234802${runId}3` },
        select: { id: true },
      });
      guardianB1 = gB1.id;

      const sB1 = await db.student.create({
        data: { schoolId: schoolB, admissionNumber: `ADM-PI-B1-${runId}`, firstName: "Student", lastName: `B1-${runId}`, dateOfBirth: new Date("2015-06-01"), gender: "OTHER" },
        select: { id: true },
      });
      studentB1 = sB1.id;

      await db.studentGuardian.create({ data: { schoolId: schoolB, studentId: studentB1, guardianId: guardianB1, isPrimary: true, canPickup: true } });

      await db.invoice.create({
        data: {
          schoolId: schoolB,
          studentId: studentB1,
          termId: term.id,
          academicYearId: year.id,
          status: "ISSUED",
          items: [],
          totalAmount: 100_000_00,
          totalDiscount: 0,
          totalDue: 100_000_00,
          totalPaid: 0,
          issuedAt: new Date(),
        },
      });
    });

    ({ rawToken: tokenA1 } = await createGuardianSession(schoolA, guardianA1, { ipAddress: "127.0.0.1", userAgent: "vitest" }));
    ({ rawToken: tokenA2 } = await createGuardianSession(schoolA, guardianA2, { ipAddress: "127.0.0.1", userAgent: "vitest" }));
    ({ rawToken: tokenB1 } = await createGuardianSession(schoolB, guardianB1, { ipAddress: "127.0.0.1", userAgent: "vitest" }));
  });

  afterAll(async () => {
    await app.close();
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("a guardian sees their own child's invoice with the correct term/items/totals", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/students/${studentA1}/invoices`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const invoice = res.body.data[0];
    expect(invoice.id).toBe(invoiceA1);
    expect(invoice.status).toBe("ISSUED");
    expect(invoice.totalDue).toBe(500_000_00);
    expect(invoice.term).toEqual({ id: termA1Id, name: termA1Name, sequence: 1 });
    expect(invoice.items).toEqual([
      {
        feeItemId: "fi-1",
        categoryName: "Tuition",
        feeName: "Term 1 Tuition",
        amount: 500_000_00,
        discountsApplied: [],
        netAmount: 500_000_00,
      },
    ]);
  });

  it("a child with zero invoices returns an empty list, not an error", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/students/${studentA2}/invoices`)
      .set("Authorization", `Bearer ${tokenA2}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("SAME-SCHOOL cross-guardian block: guardian A1 cannot fetch A2's child's invoices", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/students/${studentA2}/invoices`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("CROSS-TENANT block: guardian A1 cannot fetch school B's child's invoices", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/students/${studentB1}/invoices`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("guardian B1 (school B) cannot fetch school A's invoices either, symmetrically", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/students/${studentA1}/invoices`)
      .set("Authorization", `Bearer ${tokenB1}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("no bearer token → 401", async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/portal/students/${studentA1}/invoices`);
    expect(res.status).toBe(401);
  });

  it("invoice response contains exactly the narrow portal field set — no schoolId/issuedBy leak through", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/students/${studentA1}/invoices`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(
      [
        "id",
        "studentId",
        "term",
        "status",
        "items",
        "totalAmount",
        "totalDiscount",
        "totalDue",
        "totalPaid",
        "dueDate",
        "issuedAt",
        "createdAt",
        "updatedAt",
      ].sort(),
    );
    expect(Object.keys(res.body.data[0].term).sort()).toEqual(["id", "name", "sequence"].sort());
  });
});
