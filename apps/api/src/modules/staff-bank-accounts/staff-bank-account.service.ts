import { Injectable } from "@nestjs/common";

import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type CreateStaffBankAccountInput,
  type StaffBankAccountDto,
  type VerifyBankAccountResultDto,
  type VerifyStaffBankAccountInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { PaystackService } from "../../common/paystack/paystack.service.js";

interface RequestContext {
  ipAddress: string | null;
}

const AUDIT = {
  create: "staff-bank-account.create",
  deactivate: "staff-bank-account.deactivate",
} as const;

const STAFF_BANK_ACCOUNT_SELECT = {
  id: true,
  schoolId: true,
  userId: true,
  bankCode: true,
  accountNumber: true,
  accountName: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

type StaffBankAccountRow = {
  id: string;
  schoolId: string;
  userId: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: StaffBankAccountRow): StaffBankAccountDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    userId: row.userId,
    bankCode: row.bankCode,
    accountNumber: row.accountNumber,
    accountName: row.accountName,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Case/whitespace-insensitive compare — Paystack's resolved name shouldn't
// vary between calls, but this avoids a false-positive mismatch on the
// server-side re-check (D1) over incidental casing differences.
function namesMatch(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

@Injectable()
export class StaffBankAccountService {
  constructor(private readonly paystack: PaystackService) {}

  // POST /staff-bank-accounts/verify — read-only preview, no DB row, no
  // Paystack recipient created (CP4 plan-first D1/D2). The operator sees
  // Paystack's own resolved account name and confirms it before saving.
  async verify(dto: VerifyStaffBankAccountInput): Promise<VerifyBankAccountResultDto> {
    const resolved = await this.paystack.resolveAccount(dto.accountNumber, dto.bankCode);
    return {
      accountName: resolved.account_name,
      bankCode: dto.bankCode,
      accountNumber: dto.accountNumber,
    };
  }

  // userId has no DB-level FK (plain FK convention — see the schema.prisma
  // header comment on StaffBankAccount), so this pre-check is the ONLY thing
  // standing between a create and a silently dangling user reference.
  private async assertUserExists(db: PrismaClient, schoolId: string, userId: string): Promise<void> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, schoolId: true },
    });
    if (!user || user.schoolId !== schoolId) {
      throw new NotFoundError("Staff member not found.");
    }
  }

  // POST /staff-bank-accounts — "saving without verification is not allowed"
  // (D1) is enforced by never trusting the client-echoed accountName: this
  // independently re-resolves the account via Paystack and compares, so
  // there is no way to reach a saved row with a name the server hasn't
  // itself confirmed matches the bank's own record moments ago.
  //
  // Upsert, not create-or-reject: one row per (schoolId, userId) is
  // "current bank details," not a history table (schema.prisma header). A
  // staff member changing banks goes through the exact same verify-then-save
  // flow as the first-time save — a fresh Paystack recipient is created for
  // the new account and the row is updated in place.
  async create(
    authCtx: AuthContext,
    dto: CreateStaffBankAccountInput,
    reqCtx: RequestContext,
  ): Promise<StaffBankAccountDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertUserExists(db, authCtx.schoolId, dto.userId);

      const resolved = await this.paystack.resolveAccount(dto.accountNumber, dto.bankCode);
      if (!namesMatch(resolved.account_name, dto.accountName)) {
        throw new ConflictError(
          "ACCOUNT_VERIFICATION_MISMATCH",
          "The resolved account name no longer matches what was verified — please verify again before saving.",
        );
      }

      const recipient = await this.paystack.createTransferRecipient({
        name: resolved.account_name,
        accountNumber: dto.accountNumber,
        bankCode: dto.bankCode,
      });

      const saved = await db.staffBankAccount.upsert({
        where: { schoolId_userId: { schoolId: authCtx.schoolId, userId: dto.userId } },
        create: {
          schoolId: authCtx.schoolId,
          userId: dto.userId,
          bankCode: dto.bankCode,
          accountNumber: dto.accountNumber,
          accountName: resolved.account_name,
          paystackRecipientCode: recipient.recipient_code,
          active: true,
        },
        update: {
          bankCode: dto.bankCode,
          accountNumber: dto.accountNumber,
          accountName: resolved.account_name,
          paystackRecipientCode: recipient.recipient_code,
          active: true,
        },
        select: STAFF_BANK_ACCOUNT_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "staff_bank_account",
          entityId: saved.id,
          ipAddress: reqCtx.ipAddress,
          // accountNumber intentionally NOT in metadata — sensitive financial
          // PII, same discipline as BVN. Masked last-4 only.
          metadata: { staffUserId: dto.userId, accountNumberLast4: dto.accountNumber.slice(-4) },
        },
      });

      return toDto(saved);
    });
  }

  async findByUser(authCtx: AuthContext, userId: string): Promise<StaffBankAccountDto | null> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.staffBankAccount.findUnique({
        where: { schoolId_userId: { schoolId: authCtx.schoolId, userId } },
        select: STAFF_BANK_ACCOUNT_SELECT,
      });
      return row ? toDto(row) : null;
    });
  }

  async deactivate(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.staffBankAccount.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw new NotFoundError("Bank account not found.");

      await db.staffBankAccount.update({ where: { id }, data: { active: false } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.deactivate,
          entityType: "staff_bank_account",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {},
        },
      });
    });
  }
}
