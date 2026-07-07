import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { type PrismaClient, withTenant } from "@school-kit/db";
import {
  InternalError,
  NotFoundError,
  type BvnRevealDto,
  type BvnStatusDto,
  type CaptureBvnInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";

const AUDIT_BVN_UPDATE = "staff-bvn.update";
const AUDIT_BVN_REVEAL = "staff-bvn.reveal";

// Phase 3 / Slice 12 — BVN capture/reveal. BVN is staff/payroll PII (never
// student/guardian). NEVER log the plaintext BVN value anywhere in this
// file — the same discipline this codebase already applies to password
// hashes and session tokens. Only `bvnLast4` (safe in isolation) and the
// fact that an action occurred belong in logs or audit metadata.
//
// The encryption key never touches application code directly: it is read
// from BVN_ENCRYPTION_KEY once per call and delivered to Postgres via
// `SET LOCAL app.bvn_key`, scoped to the same withTenant transaction (mirrors
// app.current_school_id — see tenant-client.ts). The actual encrypt/decrypt
// happens inside the encrypt_bvn/decrypt_bvn SECURITY DEFINER functions
// (CLAUDE.md "SECURITY DEFINER functions — index").
@Injectable()
export class BvnService {
  private readonly logger = new Logger(BvnService.name);

  constructor(private readonly config: ConfigService) {}

  private async withBvnKey<T>(db: PrismaClient, fn: () => Promise<T>): Promise<T> {
    const key = this.config.get<string>("BVN_ENCRYPTION_KEY");
    if (!key) {
      throw new InternalError("BVN encryption key is not configured on this server.");
    }
    await db.$executeRaw`SELECT set_config('app.bvn_key', ${key}, true)`;
    return fn();
  }

  async captureBvn(
    authCtx: AuthContext,
    targetUserId: string,
    dto: CaptureBvnInput,
  ): Promise<void> {
    return withTenant(authCtx.schoolId, async (db) => {
      const target = await db.user.findUnique({
        where: { id: targetUserId },
        select: { id: true },
      });
      if (!target) {
        throw new NotFoundError("User not found.");
      }

      await this.withBvnKey(db, async () => {
        const rows = await db.$queryRaw<Array<{ ciphertext: Buffer }>>`
          SELECT encrypt_bvn(${dto.bvn}) AS ciphertext
        `;
        const [{ ciphertext }] = rows;
        await db.user.update({
          where: { id: targetUserId },
          data: { bvnEncrypted: ciphertext, bvnLast4: dto.bvn.slice(-4) },
        });
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT_BVN_UPDATE,
          entityType: "user",
          entityId: targetUserId,
          metadata: { self: targetUserId === authCtx.userId },
        },
      });

      this.logger.log(`BVN captured for user ${targetUserId} by ${authCtx.userId}`);
    });
  }

  async getBvnStatus(authCtx: AuthContext, targetUserId: string): Promise<BvnStatusDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const target = await db.user.findUnique({
        where: { id: targetUserId },
        select: { bvnEncrypted: true, bvnLast4: true },
      });
      if (!target) {
        throw new NotFoundError("User not found.");
      }
      return {
        hasBvn: target.bvnEncrypted !== null,
        bvnLast4: target.bvnLast4,
      };
    });
  }

  async revealBvn(authCtx: AuthContext, targetUserId: string): Promise<BvnRevealDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const target = await db.user.findUnique({
        where: { id: targetUserId },
        select: { bvnEncrypted: true },
      });
      if (!target) {
        throw new NotFoundError("User not found.");
      }
      if (!target.bvnEncrypted) {
        throw new NotFoundError("No BVN on file for this user.");
      }

      const bvn = await this.withBvnKey(db, async () => {
        const rows = await db.$queryRaw<Array<{ plaintext: string }>>`
          SELECT decrypt_bvn(${target.bvnEncrypted}) AS plaintext
        `;
        return rows[0].plaintext;
      });

      // Audited unconditionally, every call — CLAUDE.md: "Any access is
      // audited." Metadata records WHO revealed and for WHOM, never the
      // decrypted value itself.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT_BVN_REVEAL,
          entityType: "user",
          entityId: targetUserId,
          metadata: { self: targetUserId === authCtx.userId },
        },
      });

      return { bvn };
    });
  }
}
