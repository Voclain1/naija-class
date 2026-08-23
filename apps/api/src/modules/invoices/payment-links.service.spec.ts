import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Prisma, basePrisma, withTenant } from "@school-kit/db";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { PaymentLinksService } from "./payment-links.service.js";

describe("PaymentLinksService CP2 — real RLS, uniqueness, and lifecycle", () => {
  const runId = Math.random().toString(36).slice(2, 9);
  let schoolA: string;
  let schoolB: string;
  let invoiceA: string;
  let invoiceB: string;
  let userA: string;
  let authA: AuthContext;

  beforeAll(async () => {
    const a = await basePrisma.school.create({
      data: {
        name: `Payment Link RLS A ${runId}`,
        slug: `payment-link-rls-a-${runId}`,
        status: "ACTIVE",
        paystackPaymentsEnabled: true,
        paystackSubaccountCode: "ACCT_test_a",
        paystackSplitCode: "SPL_test_a",
      },
    });
    const b = await basePrisma.school.create({
      data: {
        name: `Payment Link RLS B ${runId}`,
        slug: `payment-link-rls-b-${runId}`,
        status: "ACTIVE",
        paystackPaymentsEnabled: true,
        paystackSubaccountCode: "ACCT_test_b",
        paystackSplitCode: "SPL_test_b",
      },
    });
    schoolA = a.id;
    schoolB = b.id;

    const bursarRole = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "bursar", isSystem: true },
      select: { id: true },
    });
    const seeded = await withTenant(schoolA, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId: schoolA,
          firstName: "RLS",
          lastName: "Bursar",
        },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: bursarRole.id } });
      const student = await db.student.create({
        data: {
          schoolId: schoolA,
          admissionNumber: `CP4-${runId}`,
          firstName: "Bursar",
          lastName: "Visible",
          dateOfBirth: new Date("2012-01-01"),
          gender: "FEMALE",
        },
      });
      const invoice = await db.invoice.create({
        data: {
          schoolId: schoolA,
          studentId: student.id,
          termId: `term-a-${runId}`,
          academicYearId: `year-a-${runId}`,
          items: [],
          totalAmount: 250_000,
          totalDiscount: 0,
          totalDue: 250_000,
          issuedAt: new Date(),
          issuedBy: user.id,
        },
      });
      return { user, invoice };
    });
    userA = seeded.user.id;
    invoiceA = seeded.invoice.id;
    invoiceB = await withTenant(schoolB, async (db) => {
      const invoice = await db.invoice.create({
        data: {
          schoolId: schoolB,
          studentId: `student-b-${runId}`,
          termId: `term-b-${runId}`,
          academicYearId: `year-b-${runId}`,
          items: [],
          totalAmount: 100_000,
          totalDiscount: 0,
          totalDue: 100_000,
          issuedAt: new Date(),
        },
      });
      return invoice.id;
    });
    authA = { sessionId: "payment-link-spec", schoolId: schoolA, userId: userA };
  });

  afterAll(async () => {
    await basePrisma.school.delete({ where: { id: schoolA } }).catch(() => undefined);
    await basePrisma.school.delete({ where: { id: schoolB } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  it("pairs a same-tenant control with cross-tenant read and WITH CHECK rejection", async () => {
    const control = await withTenant(schoolA, (db) =>
      db.paymentLink.create({
        data: { schoolId: schoolA, invoiceId: invoiceA, amount: 250_000, createdBy: userA },
      }),
    );
    expect(control.schoolId).toBe(schoolA);

    const hidden = await withTenant(schoolB, (db) =>
      db.paymentLink.findUnique({ where: { id: control.id } }),
    );
    expect(hidden).toBeNull();

    let crossTenantError: unknown;
    try {
      await withTenant(schoolB, (db) =>
        db.paymentLink.create({
          data: {
            schoolId: schoolA,
            invoiceId: invoiceA,
            amount: 250_000,
            createdBy: userA,
            status: "ARCHIVED",
          },
        }),
      );
    } catch (error) {
      crossTenantError = error;
    }
    expect(String(crossTenantError)).toMatch(/row-level security policy/i);

    const bControl = await withTenant(schoolB, (db) =>
      db.paymentLink.create({
        data: { schoolId: schoolB, invoiceId: invoiceB, amount: 100_000, createdBy: userA },
      }),
    );
    expect(bControl.schoolId).toBe(schoolB);
    await withTenant(schoolA, (db) => db.paymentLink.delete({ where: { id: control.id } }));
    await withTenant(schoolB, (db) => db.paymentLink.delete({ where: { id: bControl.id } }));
  });

  it("the runtime role sees zero rows without a tenant GUC", async () => {
    const count = await basePrisma.paymentLink.count();
    expect(count).toBe(0);
  });

  it("the partial unique index permits exactly one active row under real concurrency", async () => {
    const attempts = await Promise.allSettled([
      withTenant(schoolA, (db) =>
        db.paymentLink.create({
          data: { schoolId: schoolA, invoiceId: invoiceA, amount: 250_000, createdBy: userA },
        }),
      ),
      withTenant(schoolA, (db) =>
        db.paymentLink.create({
          data: { schoolId: schoolA, invoiceId: invoiceA, amount: 250_000, createdBy: userA },
        }),
      ),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(rejected.reason.code).toBe("P2002");
    }
    const activeCount = await withTenant(schoolA, (db) =>
      db.paymentLink.count({
        where: { schoolId: schoolA, invoiceId: invoiceA, status: { in: ["CREATING", "LIVE"] } },
      }),
    );
    expect(activeCount).toBe(1);
    await withTenant(schoolA, (db) =>
      db.paymentLink.deleteMany({ where: { schoolId: schoolA, invoiceId: invoiceA } }),
    );
  });

  it("creates one durable link with synthetic email, signed correlation metadata, and no PENDING Payment", async () => {
    let capturedEmail = "";
    let capturedMetadata: Record<string, unknown> = {};
    const paystack = {
      createCustomer: vi.fn(async ({ email }: { email: string }) => {
        capturedEmail = email;
        return { customer_code: "CUS_cp2", email };
      }),
      createPaymentRequest: vi.fn(async (input: { metadata: Record<string, unknown> }) => {
        capturedMetadata = input.metadata;
        return { request_code: `PRQ_${runId}` };
      }),
      getPaymentRequest: vi.fn(async () => ({
        id: 123456,
        request_code: `PRQ_${runId}`,
        amount: 250_000,
        currency: "NGN",
        status: "pending",
        archived: false,
        split_code: "SPL_test_a",
        metadata: capturedMetadata,
        customer: { customer_code: "CUS_cp2", email: capturedEmail },
      })),
      archivePaymentRequest: vi.fn(async () => undefined),
    };
    const service = new PaymentLinksService(paystack as never);
    const created = await service.create(authA, invoiceA, { ipAddress: "127.0.0.1" });
    expect(created).toMatchObject({
      state: "LIVE",
      url: `https://paystack.com/pay/PRQ_${runId}`,
      amount: 250_000,
      studentLabel: `Bursar Visible (CP4-${runId})`,
    });
    expect(capturedEmail).toBe("parent@schoolkit.ng");
    expect(paystack.createCustomer).toHaveBeenCalledWith({
      email: "parent@schoolkit.ng",
      firstName: "Parent",
      lastName: "School Fees",
    });
    expect(JSON.stringify(capturedMetadata)).not.toContain("example.test");
    expect(capturedMetadata).toMatchObject({ schoolId: schoolA, invoiceId: invoiceA });
    expect(await withTenant(schoolA, (db) => db.payment.count({ where: { invoiceId: invoiceA } }))).toBe(0);
    expect(
      await withTenant(schoolA, (db) =>
        db.auditLog.count({ where: { action: "payment-link.create", entityId: created.state === "LIVE" ? created.id : "" } }),
      ),
    ).toBe(1);
    expect(await service.get(authA, invoiceA)).toEqual(created);
  });

  it("fails closed on a Paystack verification mismatch and exposes only a retryable failure", async () => {
    const mismatchInvoiceId = await withTenant(schoolA, async (db) => {
      const invoice = await db.invoice.create({
        data: {
          schoolId: schoolA,
          studentId: `student-mismatch-${runId}`,
          termId: `term-mismatch-${runId}`,
          academicYearId: `year-mismatch-${runId}`,
          items: [],
          totalAmount: 75_000,
          totalDiscount: 0,
          totalDue: 75_000,
          issuedAt: new Date(),
          issuedBy: userA,
        },
      });
      return invoice.id;
    });
    const metadata: Record<string, unknown> = {};
    const paystack = {
      createCustomer: vi.fn(async ({ email }: { email: string }) => ({
        customer_code: "CUS_mismatch",
        email,
      })),
      createPaymentRequest: vi.fn(async (input: { metadata: Record<string, unknown> }) => {
        Object.assign(metadata, input.metadata);
        return { request_code: `PRQ_mismatch_${runId}` };
      }),
      getPaymentRequest: vi.fn(async () => ({
        id: 654321,
        request_code: `PRQ_mismatch_${runId}`,
        amount: 75_000,
        currency: "NGN",
        status: "pending",
        archived: false,
        split_code: "SPL_wrong_school",
        metadata,
        customer: { customer_code: "CUS_mismatch", email: "wrong@schoolkit.ng" },
      })),
      archivePaymentRequest: vi.fn(async () => undefined),
    };
    const service = new PaymentLinksService(paystack as never);

    await expect(
      service.create(authA, mismatchInvoiceId, { ipAddress: "127.0.0.1" }),
    ).rejects.toMatchObject({ code: "PAYSTACK_PAYMENT_REQUEST_MISMATCH" });
    expect(paystack.archivePaymentRequest).toHaveBeenCalledWith(`PRQ_mismatch_${runId}`);
    expect(await service.get(authA, mismatchInvoiceId)).toEqual({
      state: "RETRYABLE_FAILURE",
      failureCode: "PAYSTACK_PAYMENT_REQUEST_MISMATCH",
    });
    const failedLink = await withTenant(schoolA, (db) =>
      db.paymentLink.findFirstOrThrow({ where: { invoiceId: mismatchInvoiceId } }),
    );
    expect(failedLink).toMatchObject({
      status: "CREATE_FAILED",
      hostedUrl: null,
      requestCode: null,
      failureCode: "PAYSTACK_PAYMENT_REQUEST_MISMATCH",
    });
    expect(
      await withTenant(schoolA, (db) =>
        db.auditLog.count({ where: { action: "payment-link.create", entityId: failedLink.id } }),
      ),
    ).toBe(0);
  });

  it.each(["owner", "admin"] as const)(
    "allows an active %s through the real role gate and lifecycle",
    async (roleKey) => {
      const role = await basePrisma.role.findFirstOrThrow({
        where: { schoolId: null, key: roleKey, isSystem: true },
        select: { id: true },
      });
      const fixture = await withTenant(schoolA, async (db) => {
        const user = await db.user.create({
          data: { schoolId: schoolA, firstName: roleKey, lastName: "CP4" },
        });
        await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
        const invoice = await db.invoice.create({
          data: {
            schoolId: schoolA,
            studentId: `student-${roleKey}-${runId}`,
            termId: `term-${roleKey}-${runId}`,
            academicYearId: `year-${roleKey}-${runId}`,
            items: [],
            totalAmount: 60_000,
            totalDiscount: 0,
            totalDue: 60_000,
            issuedAt: new Date(),
            issuedBy: user.id,
          },
        });
        return { user, invoice };
      });
      const requestCode = `PRQ_${roleKey}_${runId}`;
      let email = "";
      let metadata: Record<string, unknown> = {};
      const paystack = {
        createCustomer: vi.fn(async (input: { email: string }) => {
          email = input.email;
          return { customer_code: `CUS_${roleKey}`, email };
        }),
        createPaymentRequest: vi.fn(async (input: { metadata: Record<string, unknown> }) => {
          metadata = input.metadata;
          return { request_code: requestCode };
        }),
        getPaymentRequest: vi.fn(async () => ({
          id: roleKey === "owner" ? 700001 : 700002,
          request_code: requestCode,
          amount: 60_000,
          currency: "NGN",
          status: "pending",
          archived: false,
          split_code: "SPL_test_a",
          metadata,
          customer: { customer_code: `CUS_${roleKey}`, email },
        })),
        archivePaymentRequest: vi.fn(async () => undefined),
      };
      const result = await new PaymentLinksService(paystack as never).create(
        { sessionId: `cp4-${roleKey}`, schoolId: schoolA, userId: fixture.user.id },
        fixture.invoice.id,
        { ipAddress: "127.0.0.1" },
      );
      expect(result).toMatchObject({ state: "LIVE", schoolName: `Payment Link RLS A ${runId}` });
    },
  );
});
