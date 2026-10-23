import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, Optional } from "@nestjs/common";
import type { Queue } from "bullmq";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  NotFoundError,
  PLAN_ANNOUNCEMENT_EMAILS_PER_DAY,
  type AnnouncementBouncedDto,
  type AnnouncementEmailPreviewDto,
  type AnnouncementEmailPreviewInput,
  type AnnouncementEmailSummaryDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { EmailService } from "../../common/email/email.service.js";
import { ANNOUNCEMENT_EMAIL_JOB, PUSH_QUEUE } from "../../common/queue/queue.constants.js";
import { queueJobId } from "../../common/queue/job-id.js";
import { NotificationPreferencesService } from "../notifications/notification-preferences.service.js";
import { announcementEmailHtml, blockedAddresses, familyAddresses, lagosToday, unsubscribeLinks } from "./announcement-email.shared.js";

// Phase 9 / CP8.3 — emailing an announcement to the families
// (docs/modules/phase-9.md §17.11).
//
// The send runs on the push queue, never inside the request:
//   1. prepare: one row per address (QUEUED, or SKIPPED with a reason); the
//      plan's daily allowance is taken in the same transaction, under a row
//      lock on the day's counter, and rows past it become SKIPPED (CAPPED).
//   2. send: claim up to 100 QUEUED rows (→ SENDING), send them in one Resend
//      batch, then mark them SENT (with Resend's id) or FAILED.
// A row is claimed once, so a retried job never emails anyone twice. Nothing
// here logs an address or the text: counts only.

type Db = PrismaClient;

const BATCH = 100;
/** A row SENDING for longer than this was left by a worker that died mid-batch. */
const STUCK_SENDING_MS = 15 * 60 * 1000;
const OWNER_ADMIN = ["owner", "admin"] as const;

export interface AnnouncementEmailJobData {
  schoolId: string;
  announcementId: string;
}

@Injectable()
export class AnnouncementEmailService {
  private readonly logger = new Logger(AnnouncementEmailService.name);

  constructor(
    private readonly email: EmailService,
    private readonly preferences: NotificationPreferencesService,
    @Optional() @InjectQueue(PUSH_QUEUE) private readonly queue?: Queue,
  ) {}

  /** How many addresses an announcement to this audience would email, and today's allowance. */
  async preview(authCtx: AuthContext, input: AnnouncementEmailPreviewInput): Promise<AnnouncementEmailPreviewDto> {
    await assertUserActiveAndHasOneOf(authCtx, OWNER_ADMIN);
    const channels = await this.preferences.getEnabledChannels(authCtx.schoolId);
    return withTenant(authCtx.schoolId, async (db) => {
      if (input.audience === "CLASS") {
        if (!input.classArmId) return { addresses: 0, noAddress: 0, remainingToday: 0, dailyLimit: 0, emailEnabled: channels.email };
        const arm = await db.classArm.findFirst({ where: { id: input.classArmId, schoolId: authCtx.schoolId }, select: { id: true } });
        if (!arm) throw new NotFoundError("Class not found.");
      }
      const families = await familyAddresses(db, authCtx.schoolId, { audience: input.audience, classArmId: input.classArmId ?? null });
      const emails = [...new Set(families.flatMap((f) => (f.email ? [f.email] : [])))];
      const blocked = await blockedAddresses(db, authCtx.schoolId, emails);
      const { limit, used } = await allowance(db, authCtx.schoolId);
      return {
        addresses: emails.filter((e) => !blocked.has(e)).length,
        noAddress: families.filter((f) => !f.email).length,
        remainingToday: Math.max(0, limit - used),
        dailyLimit: limit,
        emailEnabled: channels.email,
      };
    });
  }

  /** After the announcement is saved: queue its email. Never fails the announcement. */
  async enqueue(schoolId: string, announcementId: string): Promise<void> {
    try {
      if (!this.queue) {
        await this.run(schoolId, announcementId);
        return;
      }
      await this.queue.add(ANNOUNCEMENT_EMAIL_JOB, { schoolId, announcementId } satisfies AnnouncementEmailJobData, {
        jobId: queueJobId("announcement-email", announcementId),
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
    } catch (err) {
      this.logger.error(`Queueing announcement email failed; the announcement stands. ${String(err)}`);
    }
  }

  /** The job: prepare the rows, then send them in batches. Safe to run again. */
  async run(schoolId: string, announcementId: string): Promise<void> {
    const channels = await this.preferences.getEnabledChannels(schoolId);
    const ctx = await this.prepare(schoolId, announcementId, channels.email);
    if (!ctx) return;
    // Rows a dead worker left SENDING: Resend may or may not have taken them,
    // so they are marked FAILED rather than sent again (no one emailed twice).
    await withTenant(schoolId, (db) =>
      db.announcementEmail.updateMany({
        where: { schoolId, announcementId, status: "SENDING", updatedAt: { lt: new Date(Date.now() - STUCK_SENDING_MS) } },
        data: { status: "FAILED" },
      }),
    );
    for (;;) {
      const claimed = await withTenant(schoolId, async (db) => {
        const rows = await db.announcementEmail.findMany({
          where: { schoolId, announcementId, status: "QUEUED" },
          orderBy: { createdAt: "asc" },
          take: BATCH,
          select: { id: true, email: true },
        });
        if (rows.length === 0) return [];
        await db.announcementEmail.updateMany({ where: { id: { in: rows.map((r) => r.id) }, status: "QUEUED" }, data: { status: "SENDING" } });
        return rows;
      });
      if (claimed.length === 0) return;
      let ids: string[];
      try {
        ids = await this.email.sendBatch(
          claimed.map((r) => {
            const links = unsubscribeLinks(schoolId, ctx.slug, r.email);
            return {
              to: r.email,
              subject: ctx.title,
              html: announcementEmailHtml({ schoolName: ctx.schoolName, slug: ctx.slug, title: ctx.title, body: ctx.body, unsubscribeUrl: links.page }),
              headers: { "List-Unsubscribe": `<${links.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
              tags: [
                { name: "school", value: schoolId },
                { name: "announcement", value: announcementId },
              ],
            };
          }),
          { schoolName: ctx.schoolName, purpose: "announcement" },
        );
      } catch {
        // Logged (count only) by EmailService. These addresses are not tried
        // again: a half-accepted batch must not email anyone twice.
        await withTenant(schoolId, (db) =>
          db.announcementEmail.updateMany({ where: { id: { in: claimed.map((r) => r.id) }, status: "SENDING" }, data: { status: "FAILED" } }),
        );
        continue;
      }
      // Outside the try: Resend has accepted these, so a failure here must
      // not mark them FAILED (their delivery reports would then be ignored).
      const now = new Date();
      await withTenant(schoolId, async (db) => {
        for (const [i, r] of claimed.entries()) {
          await db.announcementEmail.update({ where: { id: r.id }, data: { status: "SENT", providerId: ids[i]!, sentAt: now } });
        }
      });
    }
  }

  /** One row per address; the day's allowance taken under a lock. Null when there is nothing to send. */
  private async prepare(schoolId: string, announcementId: string, emailOn: boolean) {
    return withTenant(schoolId, async (db) => {
      const a = await db.announcement.findFirst({
        where: { id: announcementId, schoolId },
        select: { title: true, body: true, audience: true, classArmId: true, emailFamilies: true, withdrawnAt: true },
      });
      if (!a || !a.emailFamilies) return null;
      const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, slug: true } });

      const already = await db.announcementEmail.count({ where: { schoolId, announcementId } });
      if (already === 0) {
        const families = await familyAddresses(db, schoolId, a);
        const byEmail = new Map<string, string>();
        for (const f of families) if (f.email && !byEmail.has(f.email)) byEmail.set(f.email, f.guardianId);
        const blocked = await blockedAddresses(db, schoolId, [...byEmail.keys()]);
        // Withdrawn before the job ran: send nothing new.
        const off = !emailOn || a.withdrawnAt !== null;
        const rows = [...byEmail.entries()].map(([email, guardianId]) => {
          const reason = off ? "EMAIL_OFF" : blocked.get(email);
          return { schoolId, announcementId, guardianId, email, status: reason ? "SKIPPED" : "QUEUED", skipReason: reason ?? null };
        });
        if (rows.length) await db.announcementEmail.createMany({ data: rows, skipDuplicates: true });
        await db.announcement.update({ where: { id: announcementId }, data: { emailNoAddress: new Set(families.filter((f) => !f.email).map((f) => f.guardianId)).size } });

        const queued = rows.filter((r) => r.status === "QUEUED");
        if (queued.length) {
          const granted = await takeAllowance(db, schoolId, queued.length);
          const capped = queued.slice(granted).map((r) => r.email);
          if (capped.length) {
            await db.announcementEmail.updateMany({
              where: { schoolId, announcementId, email: { in: capped }, status: "QUEUED" },
              data: { status: "SKIPPED", skipReason: "CAPPED" },
            });
          }
        }
      }
      return { title: a.title, body: a.body, schoolName: school.name, slug: school.slug };
    });
  }

  /** Delivery counts for these announcements (only those emailed appear). */
  async summaries(db: Db, schoolId: string, announcementIds: string[]): Promise<Map<string, AnnouncementEmailSummaryDto>> {
    const out = new Map<string, AnnouncementEmailSummaryDto>();
    if (announcementIds.length === 0) return out;
    const rows = await db.announcementEmail.groupBy({
      by: ["announcementId", "status", "skipReason"],
      where: { schoolId, announcementId: { in: announcementIds } },
      _count: { _all: true },
    });
    const noAddress = await db.announcement.findMany({ where: { schoolId, id: { in: announcementIds } }, select: { id: true, emailNoAddress: true } });
    for (const a of noAddress) out.set(a.id, { ...emptySummary(), noAddress: a.emailNoAddress });
    for (const r of rows) {
      const s = out.get(r.announcementId)!;
      const n = r._count._all;
      switch (r.status) {
        case "QUEUED":
        case "SENDING":
          s.waiting += n;
          break;
        case "SENT":
          s.sent += n;
          break;
        case "DELIVERED":
          s.sent += n;
          s.delivered += n;
          break;
        case "BOUNCED":
          s.sent += n;
          s.bounced += n;
          break;
        case "COMPLAINED":
          s.sent += n;
          s.complained += n;
          break;
        case "FAILED":
          s.failed += n;
          break;
        case "SKIPPED":
          if (r.skipReason === "UNSUBSCRIBED") s.unsubscribed += n;
          else if (r.skipReason === "SUPPRESSED") s.suppressed += n;
          else if (r.skipReason === "CAPPED") s.capped += n;
          else s.emailOff += n;
          break;
      }
    }
    return out;
  }

  /** Addresses that bounced or complained, for the school to fix. */
  async bounced(authCtx: AuthContext, announcementId: string): Promise<AnnouncementBouncedDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, OWNER_ADMIN);
    return withTenant(authCtx.schoolId, async (db) => {
      const a = await db.announcement.findFirst({ where: { id: announcementId, schoolId: authCtx.schoolId }, select: { id: true } });
      if (!a) throw new NotFoundError("Announcement not found.");
      const rows = await db.announcementEmail.findMany({
        where: { schoolId: authCtx.schoolId, announcementId, status: { in: ["BOUNCED", "COMPLAINED"] } },
        orderBy: { email: "asc" },
        select: {
          email: true,
          status: true,
          guardian: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              students: { select: { student: { select: { firstName: true, lastName: true } } } },
            },
          },
        },
      });
      return rows.map((r) => ({
        guardianId: r.guardian?.id ?? null,
        guardianName: r.guardian ? `${r.guardian.firstName} ${r.guardian.lastName}`.trim() : null,
        email: r.email,
        children: (r.guardian?.students ?? []).map((s) => `${s.student.firstName} ${s.student.lastName}`.trim()),
        status: r.status as "BOUNCED" | "COMPLAINED",
      }));
    });
  }
}

function emptySummary(): AnnouncementEmailSummaryDto {
  return { waiting: 0, sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0, unsubscribed: 0, suppressed: 0, capped: 0, emailOff: 0, noAddress: 0 };
}

async function allowance(db: Db, schoolId: string): Promise<{ limit: number; used: number }> {
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { plan: true } });
  const row = await db.announcementEmailCounter.findUnique({ where: { schoolId_day: { schoolId, day: lagosToday() } }, select: { sent: true } });
  return { limit: PLAN_ANNOUNCEMENT_EMAILS_PER_DAY[school.plan], used: row?.sent ?? 0 };
}

/** Takes up to `wanted` of today's allowance; returns how many it took. Runs under the caller's transaction. */
async function takeAllowance(db: Db, schoolId: string, wanted: number): Promise<number> {
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { plan: true } });
  const limit = PLAN_ANNOUNCEMENT_EMAILS_PER_DAY[school.plan];
  const day = lagosToday();
  await db.$executeRaw(Prisma.sql`
    INSERT INTO announcement_email_counters (school_id, day, sent) VALUES (${schoolId}, ${day}::date, 0)
    ON CONFLICT (school_id, day) DO NOTHING`);
  const [row] = await db.$queryRaw<{ sent: number }[]>(Prisma.sql`
    SELECT sent FROM announcement_email_counters WHERE school_id = ${schoolId} AND day = ${day}::date FOR UPDATE`);
  const granted = Math.max(0, Math.min(wanted, limit - (row?.sent ?? 0)));
  if (granted > 0) {
    await db.$executeRaw(Prisma.sql`
      UPDATE announcement_email_counters SET sent = sent + ${granted} WHERE school_id = ${schoolId} AND day = ${day}::date`);
  }
  return granted;
}
