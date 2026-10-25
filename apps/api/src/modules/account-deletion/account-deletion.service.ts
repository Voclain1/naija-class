import { Injectable } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  NotFoundError,
  type AccountDeletionPrincipal,
  type AccountDeletionRequestDto,
  type MyAccountDeletionRequestDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";

// Account deletion requests (docs/modules/account-deletion-requests.md). The
// app stores require a way to ask from inside the app; the school holds the
// records, so a request only tells the school. Nothing is deleted here.

interface RequestContext {
  ipAddress: string | null;
}

interface Subject {
  schoolId: string;
  principal: AccountDeletionPrincipal;
  /** users.id, guardians.id or students.id. */
  subjectId: string;
  /** Staff only: the audit row's user. */
  userId?: string;
}

const AUDIT = { requested: "account.deletion_requested", handled: "account.deletion_request_handled" } as const;

@Injectable()
export class AccountDeletionService {
  /** The person's own open request, or null. */
  async mine(subject: Subject): Promise<MyAccountDeletionRequestDto> {
    const open = await withTenant(subject.schoolId, (db) =>
      db.accountDeletionRequest.findFirst({
        where: { principal: subject.principal, subjectId: subject.subjectId, handledAt: null },
        select: { requestedAt: true },
      }),
    );
    return { requestedAt: open?.requestedAt.toISOString() ?? null };
  }

  /** Asks the school to delete the account. Asking again returns the open request. */
  async request(subject: Subject, reqCtx: RequestContext): Promise<MyAccountDeletionRequestDto> {
    const existing = await this.mine(subject);
    if (existing.requestedAt) return existing;
    try {
      await withTenant(subject.schoolId, async (db) => {
        const row = await db.accountDeletionRequest.create({
          data: { schoolId: subject.schoolId, principal: subject.principal, subjectId: subject.subjectId },
          select: { id: true },
        });
        await db.auditLog.create({
          data: {
            schoolId: subject.schoolId,
            userId: subject.userId ?? null,
            action: AUDIT.requested,
            entityType: "account_deletion_request",
            entityId: row.id,
            ipAddress: reqCtx.ipAddress,
            metadata: { principal: subject.principal, subjectId: subject.subjectId },
          },
        });
      });
    } catch (e) {
      // Two taps at once: the partial unique index keeps one open request.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
    return this.mine(subject);
  }

  /** Open requests, oldest first, with each person's name. Owner and admin. */
  async list(authCtx: AuthContext): Promise<AccountDeletionRequestDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.accountDeletionRequest.findMany({
        where: { handledAt: null },
        orderBy: { requestedAt: "asc" },
        select: { id: true, principal: true, subjectId: true, requestedAt: true },
        take: 500,
      });
      const ids = (p: string) => rows.filter((r) => r.principal === p).map((r) => r.subjectId);
      const [users, guardians, students] = await Promise.all([
        db.user.findMany({ where: { id: { in: ids("STAFF") } }, select: { id: true, firstName: true, lastName: true } }),
        db.guardian.findMany({ where: { id: { in: ids("GUARDIAN") } }, select: { id: true, firstName: true, lastName: true } }),
        db.student.findMany({ where: { id: { in: ids("STUDENT") } }, select: { id: true, firstName: true, lastName: true } }),
      ]);
      const names = new Map<string, string>();
      for (const p of [...users, ...guardians, ...students]) names.set(p.id, `${p.firstName} ${p.lastName}`);
      return rows.map((r) => ({
        id: r.id,
        principal: r.principal as AccountDeletionPrincipal,
        subjectId: r.subjectId,
        name: names.get(r.subjectId) ?? null,
        requestedAt: r.requestedAt.toISOString(),
      }));
    });
  }

  /** Marks a request handled, once the school has removed the account or decided to keep it. */
  async markHandled(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    await withTenant(authCtx.schoolId, async (db) => {
      const updated = await db.accountDeletionRequest.updateMany({
        where: { id, handledAt: null },
        data: { handledAt: new Date(), handledBy: authCtx.userId },
      });
      if (updated.count === 0) throw new NotFoundError("Request not found, or already handled.");
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.handled,
          entityType: "account_deletion_request",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {},
        },
      });
    });
  }

}

/** Open requests, for the dashboard's "needs you today". Runs on the caller's tenant client. */
export function openAccountDeletionRequestCount(db: PrismaClient): Promise<number> {
  return db.accountDeletionRequest.count({ where: { handledAt: null } });
}
