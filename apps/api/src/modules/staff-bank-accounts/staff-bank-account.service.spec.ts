import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { StaffBankAccountService } from "./staff-bank-account.service";

// Phase 3 / Payroll CP4a — staff bank account integration spec. Real DB + RLS
// (mocking Prisma would defeat the point — the whole feature is "does the
// row + RLS round-trip actually work"), but PaystackService IS stubbed —
// same precedent payments.service.spec.ts already established for Slice 8
// (makePaystackStub): a hand-rolled object implementing the method surface,
// injected via the constructor, no real network calls, no test-mode secret.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23495${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: null as string | null };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

// Stub PaystackService so integration tests don't hit the real Paystack API.
// Overrides allow individual tests to simulate a different resolved name
// (mismatch scenarios) or a resolve/recipient-creation failure.
function makePaystackStub(overrides: {
  resolveAccount?: (...args: unknown[]) => Promise<unknown>;
  createTransferRecipient?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    resolveAccount:
      overrides.resolveAccount ??
      (async (accountNumber: string, bankCode: string) => ({
        account_number: accountNumber,
        account_name: "Betty Bursar",
        bank_id: Number(bankCode),
      })),
    createTransferRecipient:
      overrides.createTransferRecipient ??
      (async () => ({ recipient_code: `RCP_${Math.random().toString(36).slice(2)}`, active: true })),
  };
}

describe("StaffBankAccountService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `BankAcct ${suffix}`,
        schoolSlug: `bankacct-${suffix}-${runId}`,
        ownerFirstName: "Bea",
        ownerLastName: "Owner",
        ownerEmail: `bankacct-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  async function makeStaff(schoolId: string, suffix: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: {
          schoolId,
          email: `staff-${suffix}-${runId}@example.test`,
          phone: randomPhone(),
          firstName: "Sam",
          lastName: "Staff",
        },
        select: { id: true },
      });
      return u.id;
    });
  }

  describe("verify", () => {
    it("resolves an account number + bank code to Paystack's own account name", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const result = await svc.verify({ bankCode: "058", accountNumber: "0123456789" });
      expect(result.accountName).toBe("Betty Bursar");
      expect(result.bankCode).toBe("058");
      expect(result.accountNumber).toBe("0123456789");
    });
  });

  describe("create", () => {
    it("creates a bank account when the client-echoed name matches the re-resolved name", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const { schoolId, ownerId } = await makeSchool("c1");
      const staffId = await makeStaff(schoolId, "c1");

      const result = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, bankCode: "058", accountNumber: "0123456789", accountName: "Betty Bursar" },
        reqCtx,
      );
      expect(result.accountName).toBe("Betty Bursar");
      expect(result.active).toBe(true);
    });

    it("accepts a case/whitespace-different but substantively matching name", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const { schoolId, ownerId } = await makeSchool("c2");
      const staffId = await makeStaff(schoolId, "c2");

      const result = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, bankCode: "058", accountNumber: "0123456789", accountName: "  betty bursar  " },
        reqCtx,
      );
      expect(result.accountName).toBe("Betty Bursar"); // stores the server-resolved value, not the client's
    });

    it("rejects when the re-resolved name doesn't match the client-echoed name", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const { schoolId, ownerId } = await makeSchool("c3");
      const staffId = await makeStaff(schoolId, "c3");

      await expect(
        svc.create(
          ctx(schoolId, ownerId),
          { userId: staffId, bankCode: "058", accountNumber: "0123456789", accountName: "A Totally Different Name" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("rejects a userId that doesn't exist", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const { schoolId, ownerId } = await makeSchool("c4");
      await expect(
        svc.create(
          ctx(schoolId, ownerId),
          { userId: "00000000-0000-0000-0000-000000000000", bankCode: "058", accountNumber: "0123456789", accountName: "Betty Bursar" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("rejects a userId belonging to a different school", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const a = await makeSchool("c5a");
      const b = await makeSchool("c5b");
      const staffOfB = await makeStaff(b.schoolId, "c5b");

      await expect(
        svc.create(
          ctx(a.schoolId, a.ownerId),
          { userId: staffOfB, bankCode: "058", accountNumber: "0123456789", accountName: "Betty Bursar" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("upserts: a second create for the same staff member replaces the bank details in place", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const { schoolId, ownerId } = await makeSchool("c6");
      const staffId = await makeStaff(schoolId, "c6");

      const first = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, bankCode: "058", accountNumber: "0123456789", accountName: "Betty Bursar" },
        reqCtx,
      );

      const stub2 = makePaystackStub({
        resolveAccount: async () => ({ account_number: "9876543210", account_name: "Betty B. Bursar", bank_id: 44 }),
      });
      const svc2 = new StaffBankAccountService(stub2 as never);
      const second = await svc2.create(
        ctx(schoolId, ownerId),
        { userId: staffId, bankCode: "044", accountNumber: "9876543210", accountName: "Betty B. Bursar" },
        reqCtx,
      );

      expect(second.id).toBe(first.id); // same row, updated in place — not a second row
      expect(second.bankCode).toBe("044");
      expect(second.accountNumber).toBe("9876543210");

      const rows = await withTenant(schoolId, (db) =>
        db.staffBankAccount.findMany({ where: { schoolId, userId: staffId } }),
      );
      expect(rows).toHaveLength(1);
    });

    it("writes a staff-bank-account.create audit row with a masked account number, never the full one", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const { schoolId, ownerId } = await makeSchool("c7");
      const staffId = await makeStaff(schoolId, "c7");

      const result = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, bankCode: "058", accountNumber: "0123456789", accountName: "Betty Bursar" },
        reqCtx,
      );

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({ where: { action: "staff-bank-account.create", entityId: result.id } }),
      );
      expect(audit).toBeTruthy();
      const meta = audit!.metadata as Record<string, unknown>;
      expect(meta.accountNumberLast4).toBe("6789");
      expect(JSON.stringify(meta)).not.toContain("0123456789");
    });
  });

  describe("findByUser", () => {
    it("returns null when no bank account is on file", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const { schoolId, ownerId } = await makeSchool("f1");
      const staffId = await makeStaff(schoolId, "f1");
      const result = await svc.findByUser(ctx(schoolId, ownerId), staffId);
      expect(result).toBeNull();
    });

    it("School B cannot read School A's staff bank account", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const a = await makeSchool("f2a");
      const b = await makeSchool("f2b");
      const staffA = await makeStaff(a.schoolId, "f2a");
      await svc.create(
        ctx(a.schoolId, a.ownerId),
        { userId: staffA, bankCode: "058", accountNumber: "0123456789", accountName: "Betty Bursar" },
        reqCtx,
      );

      const result = await svc.findByUser(ctx(b.schoolId, b.ownerId), staffA);
      expect(result).toBeNull();
    });
  });

  describe("deactivate", () => {
    it("sets active=false and writes an audit row", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const { schoolId, ownerId } = await makeSchool("d1");
      const staffId = await makeStaff(schoolId, "d1");
      const created = await svc.create(
        ctx(schoolId, ownerId),
        { userId: staffId, bankCode: "058", accountNumber: "0123456789", accountName: "Betty Bursar" },
        reqCtx,
      );

      await svc.deactivate(ctx(schoolId, ownerId), created.id, reqCtx);

      const result = await svc.findByUser(ctx(schoolId, ownerId), staffId);
      expect(result?.active).toBe(false);

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({ where: { action: "staff-bank-account.deactivate", entityId: created.id } }),
      );
      expect(audit).toBeTruthy();
    });

    it("rejects an id that doesn't exist", async () => {
      const svc = new StaffBankAccountService(makePaystackStub() as never);
      const { schoolId, ownerId } = await makeSchool("d2");
      await expect(
        svc.deactivate(ctx(schoolId, ownerId), "00000000-0000-0000-0000-000000000000", reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
