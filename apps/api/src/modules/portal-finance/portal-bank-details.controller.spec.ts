import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { basePrisma, withTenant } from "@school-kit/db";

import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { createGuardianSession } from "../../common/auth/guardian-sessions";
import { createStudentSession } from "../../common/auth/student-sessions";
import { PortalFinanceModule } from "./portal-finance.module";

// GET /portal/bank-details — real Postgres, real guardian sessions.
//
// The property this suite exists to pin is NOT "the enabled school's details
// come back" — that would pass against an endpoint that returned the raw
// columns and left hiding them to the page. It is that a DISABLED or
// INCOMPLETE school's stored digits never appear anywhere in the response
// body. Those assertions search the serialised body for the account number
// itself, so a regression that returned the raw fields (or a partial object)
// fails here rather than in a parent's browser.

const ACCOUNT_A = "0123456789"; // enabled + complete  → shown
const ACCOUNT_B = "9876543210"; // complete but DISABLED → never sent
const ACCOUNT_C = "5555666677"; // enabled but bank name blank → never sent

describe("PortalBankDetailsController", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const schoolIds: string[] = [];
  let app: INestApplication;

  let schoolA: string;
  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let studentTokenA: string;

  async function makeSchool(
    label: string,
    bank: { bankName: string | null; bankAccountName: string | null; bankAccountNumber: string | null; bankDetailsEnabled: boolean },
  ): Promise<{ schoolId: string; guardianToken: string; studentId: string }> {
    const school = await basePrisma.school.create({
      data: { name: `Portal Bank ${label} ${runId}`, slug: `portal-bank-${label.toLowerCase()}-${runId}`, ...bank },
      select: { id: true },
    });
    schoolIds.push(school.id);

    const { guardianId, studentId } = await withTenant(school.id, async (db) => {
      const g = await db.guardian.create({
        data: { schoolId: school.id, firstName: "Ada", lastName: `Bank${label}-${runId}`, relationship: "MOTHER", phone: `+234803${runId}${label.charCodeAt(0) % 10}` },
        select: { id: true },
      });
      const s = await db.student.create({
        data: {
          schoolId: school.id,
          admissionNumber: `ADM-PB-${label}-${runId}`,
          firstName: "Student",
          lastName: `${label}-${runId}`,
          dateOfBirth: new Date("2014-01-01"),
          gender: "FEMALE",
          // Portal-enabled, so the student token below is a VALID student
          // session — its 401 here is the guard refusing the principal, not
          // a dead token.
          passwordHash: "not-a-real-hash",
          activatedAt: new Date(),
        },
        select: { id: true },
      });
      await db.studentGuardian.create({ data: { schoolId: school.id, studentId: s.id, guardianId: g.id, isPrimary: true, canPickup: true } });
      return { guardianId: g.id, studentId: s.id };
    });

    const { rawToken } = await createGuardianSession(school.id, guardianId, { ipAddress: "127.0.0.1", userAgent: "vitest" });
    return { schoolId: school.id, guardianToken: rawToken, studentId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PortalFinanceModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const a = await makeSchool("A", { bankName: "Zenith Bank", bankAccountName: "Bright Future Academy", bankAccountNumber: ACCOUNT_A, bankDetailsEnabled: true });
    const b = await makeSchool("B", { bankName: "Access Bank", bankAccountName: "Other School Ltd", bankAccountNumber: ACCOUNT_B, bankDetailsEnabled: false });
    const c = await makeSchool("C", { bankName: "   ", bankAccountName: "Half Filled School", bankAccountNumber: ACCOUNT_C, bankDetailsEnabled: true });
    schoolA = a.schoolId;
    tokenA = a.guardianToken;
    tokenB = b.guardianToken;
    tokenC = c.guardianToken;
    ({ rawToken: studentTokenA } = await createStudentSession(a.schoolId, a.studentId, { ipAddress: "127.0.0.1", userAgent: "vitest" }));
  });

  afterAll(async () => {
    await app.close();
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  const get = (token?: string) => {
    const req = request(app.getHttpServer()).get("/api/v1/portal/bank-details");
    return token ? req.set("Authorization", `Bearer ${token}`) : req;
  };

  it("enabled + complete: the guardian gets exactly the three display fields", async () => {
    const res = await get(tokenA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      bankTransfer: { bankName: "Zenith Bank", bankAccountName: "Bright Future Academy", bankAccountNumber: ACCOUNT_A },
    });
    // No toggle, no school id — nothing beyond what the page renders.
    expect(Object.keys(res.body.bankTransfer).sort()).toEqual(["bankAccountName", "bankAccountNumber", "bankName"]);
  });

  it("DISABLED: null, and the stored account number is nowhere in the body", async () => {
    const res = await get(tokenB);
    expect(res.status).toBe(200);
    // Leak assertions run BEFORE the shape assertion, deliberately. Any leak
    // also changes the body's shape, so with toEqual first a leak would
    // always be reported by toEqual and these lines would never be observed
    // failing on their own. In this order, a leak is caught by the assertion
    // whose whole job is catching it — proven by mutation (a service that
    // kept bankTransfer null but returned the raw row alongside it).
    expect(res.text).not.toContain(ACCOUNT_B);
    expect(res.text).not.toContain("Other School Ltd");
    expect(res.body).toEqual({ bankTransfer: null });
  });

  it("enabled but INCOMPLETE (blank bank name): null, never a partial block", async () => {
    const res = await get(tokenC);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(ACCOUNT_C); // before toEqual — see the DISABLED case
    expect(res.body).toEqual({ bankTransfer: null });
  });

  it("CROSS-TENANT: other schools' guardians never receive school A's account", async () => {
    for (const token of [tokenB, tokenC]) {
      const res = await get(token);
      expect(res.text).not.toContain(ACCOUNT_A);
    }
  });

  it("re-read per request: switching the toggle off hides it on the very next call", async () => {
    await basePrisma.school.update({ where: { id: schoolA }, data: { bankDetailsEnabled: false } });
    try {
      const res = await get(tokenA);
      expect(res.text).not.toContain(ACCOUNT_A); // before toEqual — see the DISABLED case
      expect(res.body).toEqual({ bankTransfer: null });
    } finally {
      await basePrisma.school.update({ where: { id: schoolA }, data: { bankDetailsEnabled: true } });
    }
    const restored = await get(tokenA);
    expect(restored.body.bankTransfer?.bankAccountNumber).toBe(ACCOUNT_A);
  });

  it("no bearer token → 401", async () => {
    const res = await get();
    expect(res.status).toBe(401);
  });

  it("a valid STUDENT session is refused — guardian-only surface", async () => {
    const res = await get(studentTokenA);
    expect(res.status).toBe(401);
    expect(res.text).not.toContain(ACCOUNT_A);
  });
});
