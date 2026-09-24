import { Injectable, Logger, Optional } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type AnnouncementDto,
  type AnnouncementFeedItemDto,
  type AnnouncementFeedResponse,
  type AnnouncementListResponse,
  type CreateAnnouncementInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { EventNotifierService } from "../notifications/event-notifier.service.js";

// Announcements (docs/modules/announcements.md).
//
// Three rules run through everything here:
//
//  A2 — SENT ONCE, NEVER SILENTLY REWORDED. There is no edit path, on purpose:
//       a message people have acted on is not a draft. It can be WITHDRAWN,
//       which stops it appearing and says so, and a correction is a new
//       announcement.
//  A3 — DELIVERY REUSES THE NOTIFICATION RAIL, without exception. No sending
//       code lives here, so announcements inherit lockscreen safety, quiet
//       hours, once-per-person and the queue for free — and can never reach
//       SMS (N4).
//  A5 — READ STATE IS THE READER'S. It drives their own unread dot and never
//       travels back to the school as a receipt.

const AUDIT = {
  create: "announcement.create",
  withdraw: "announcement.withdraw",
} as const;

// Sending is owner/admin (A1) — a teacher messaging the whole school is a
// different feature. Written as a literal array at each call site, because
// rbac-two-gate-conformance.spec.ts reads the allowed roles from source.

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(@Optional() private readonly events?: EventNotifierService) {}

  async create(
    authCtx: AuthContext,
    input: CreateAnnouncementInput,
    reqCtx: { ipAddress: string | null },
  ): Promise<AnnouncementDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const announcement = await withTenant(authCtx.schoolId, async (db) => {
      if (input.classArmId) {
        const arm = await db.classArm.findUnique({ where: { id: input.classArmId }, select: { id: true } });
        if (!arm) throw new NotFoundError("Class not found.");
      }
      const row = await db.announcement.create({
        data: {
          schoolId: authCtx.schoolId,
          title: input.title,
          body: input.body,
          audience: input.audience,
          classArmId: input.classArmId ?? null,
          urgent: input.urgent ?? false,
          createdBy: authCtx.userId,
        },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "announcement",
          entityId: row.id,
          ipAddress: reqCtx.ipAddress,
          // Urgent is recorded because it wakes phones at any hour (A4) —
          // a decision someone should be accountable for.
          metadata: { audience: row.audience, classArmId: row.classArmId, urgent: row.urgent },
        },
      });
      return row;
    });

    // After the commit, and never able to fail the announcement itself.
    await this.events?.announcementPosted({ schoolId: authCtx.schoolId, announcementId: announcement.id });

    return this.toDto(announcement, null, null);
  }

  /** The staff list: everything this school has sent, newest first. */
  async list(authCtx: AuthContext): Promise<AnnouncementListResponse> {
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
      const armIds = [...new Set(rows.map((r) => r.classArmId).filter((id): id is string => id !== null))];
      const senderIds = [...new Set(rows.map((r) => r.createdBy))];
      const [arms, senders] = await Promise.all([
        armIds.length ? db.classArm.findMany({ where: { id: { in: armIds } }, select: { id: true, name: true } }) : [],
        db.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, firstName: true, lastName: true } }),
      ]);
      const armName = new Map<string, string>(arms.map((a): [string, string] => [a.id, a.name]));
      const senderName = new Map<string, string>(
        senders.map((u): [string, string] => [u.id, `${u.firstName} ${u.lastName}`]),
      );
      return {
        data: rows.map((row) =>
          this.toDto(row, row.classArmId ? (armName.get(row.classArmId) ?? null) : null, senderName.get(row.createdBy) ?? null),
        ),
      };
    });
  }

  /**
   * Withdraw (A2). The announcement stops appearing on every read surface;
   * the row stays, because what was sent was sent.
   */
  async withdraw(
    authCtx: AuthContext,
    id: string,
    reqCtx: { ipAddress: string | null },
  ): Promise<AnnouncementDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.announcement.findUnique({ where: { id } });
      if (!existing || existing.schoolId !== authCtx.schoolId) throw new NotFoundError("Announcement not found.");
      if (existing.withdrawnAt) {
        throw new ConflictError("ALREADY_WITHDRAWN", "This announcement has already been withdrawn.");
      }
      const row = await db.announcement.update({
        where: { id },
        data: { withdrawnAt: new Date(), withdrawnBy: authCtx.userId },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.withdraw,
          entityType: "announcement",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { audience: row.audience },
        },
      });
      return this.toDto(row, null, null);
    });
  }

  /**
   * What a guardian sees: everything for EVERYONE or PARENTS, plus anything
   * sent to a class one of their children is in — and nothing withdrawn.
   */
  async guardianFeed(schoolId: string, guardianId: string): Promise<AnnouncementFeedResponse> {
    return withTenant(schoolId, async (db) => {
      const links = await db.studentGuardian.findMany({ where: { guardianId }, select: { studentId: true } });
      const enrollments = await db.enrollment.findMany({
        where: { studentId: { in: links.map((l) => l.studentId) }, term: { isCurrent: true } },
        select: { classArmId: true },
      });
      const armIds = [...new Set(enrollments.map((e) => e.classArmId))];
      return this.feed(db, schoolId, ["EVERYONE", "PARENTS"], armIds, "GUARDIAN", guardianId);
    });
  }

  /** What a student sees: EVERYONE, plus their own class. Never PARENTS. */
  async studentFeed(schoolId: string, studentId: string): Promise<AnnouncementFeedResponse> {
    return withTenant(schoolId, async (db) => {
      const enrollment = await db.enrollment.findFirst({
        where: { studentId, term: { isCurrent: true } },
        select: { classArmId: true },
      });
      return this.feed(db, schoolId, ["EVERYONE"], enrollment ? [enrollment.classArmId] : [], "STUDENT", studentId);
    });
  }

  /** What a staff member sees in the app: EVERYONE and STAFF. */
  async staffFeed(authCtx: AuthContext): Promise<AnnouncementFeedResponse> {
    return withTenant(authCtx.schoolId, (db) =>
      this.feed(db, authCtx.schoolId, ["EVERYONE", "STAFF"], [], "STAFF", authCtx.userId),
    );
  }

  async markRead(
    schoolId: string,
    announcementId: string,
    principalType: "GUARDIAN" | "STUDENT" | "STAFF",
    principalId: string,
  ): Promise<void> {
    await withTenant(schoolId, async (db) => {
      const announcement = await db.announcement.findUnique({
        where: { id: announcementId },
        select: { schoolId: true },
      });
      if (!announcement || announcement.schoolId !== schoolId) throw new NotFoundError("Announcement not found.");
      // Reading twice is not an error: the app marks on open, and an open is
      // not a promise that the previous one failed.
      await db.announcementRead
        .create({ data: { announcementId, principalType, principalId } })
        .catch(() => undefined);
    });
  }

  private async feed(
    db: Parameters<Parameters<typeof withTenant>[1]>[0],
    schoolId: string,
    audiences: Array<"EVERYONE" | "PARENTS" | "STAFF">,
    classArmIds: string[],
    principalType: "GUARDIAN" | "STUDENT" | "STAFF",
    principalId: string,
  ): Promise<AnnouncementFeedResponse> {
    const rows = await db.announcement.findMany({
      where: {
        schoolId,
        // A2: withdrawn announcements disappear from every read surface.
        withdrawnAt: null,
        OR: [
          { audience: { in: audiences } },
          ...(classArmIds.length ? [{ audience: "CLASS" as const, classArmId: { in: classArmIds } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const reads = await db.announcementRead.findMany({
      where: { announcementId: { in: rows.map((r) => r.id) }, principalType, principalId },
      select: { announcementId: true, readAt: true },
    });
    const readAt = new Map(reads.map((r) => [r.announcementId, r.readAt]));
    const data: AnnouncementFeedItemDto[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      urgent: row.urgent,
      createdAt: row.createdAt,
      readAt: readAt.get(row.id) ?? null,
    }));
    return { data, unreadCount: data.filter((item) => item.readAt === null).length };
  }

  private toDto(
    row: {
      id: string;
      title: string;
      body: string;
      audience: string;
      classArmId: string | null;
      urgent: boolean;
      createdAt: Date;
      createdBy: string;
      withdrawnAt: Date | null;
    },
    className: string | null,
    createdByName: string | null,
  ): AnnouncementDto {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      audience: row.audience as AnnouncementDto["audience"],
      classArmId: row.classArmId,
      className,
      urgent: row.urgent,
      createdAt: row.createdAt,
      createdByName,
      withdrawnAt: row.withdrawnAt,
    };
  }
}
