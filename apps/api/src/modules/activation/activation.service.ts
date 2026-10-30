import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ACTIVATION_LINK_TARGETS,
  activationStage,
  nextActivationEmail,
  type ActivationCounts,
  type ActivationEmailKind,
  type ActivationEmailStatus,
  type ActivationLinkTarget,
  type ActivationStage,
} from "@school-kit/types";

import { EmailService } from "../../common/email/email.service.js";
import { staffSiteUrl } from "../../common/school-site-url.js";
import { isSuppressedForAll } from "../announcements/announcement-email.shared.js";
import {
  clickUrl,
  reminderEmailHtml,
  reminderStep,
  stopSignatureValid,
  stopUrl,
  linkSignatureValid,
  targetUrl,
} from "./activation.shared.js";

// Getting started (docs/modules/activation.md): setup reminders to the owners
// of schools that have not got their students into classes yet, and what
// happened to each one.
//
// basePrisma reads `schools` only (no RLS): the list of schools, and the
// "stop these emails" stamp. Everything about a school's students, staff,
// owner and reminders is read and written under that school's own GUC through
// withTenant, so no SECURITY DEFINER function is needed (count stays 23).

type Db = PrismaClient;

export const ACTIVATION_AUDIT = {
  sent: "activation_email.sent",
  stopped: "activation_email.stopped",
} as const;

/** How many schools signed up before reminders existed may get their first one per run. */
export const MAX_CATCH_UP_PER_RUN = 25;

/** Live counts for a school's stage, under its own GUC. */
export async function schoolCounts(
  db: Db,
  setUp: boolean,
): Promise<ActivationCounts> {
  const currentTerm = await db.term.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });
  const [
    students,
    enrolled,
    teachers,
    teacherInvites,
    register,
    invoice,
    score,
  ] = await Promise.all([
    db.student.count({ where: { status: "ACTIVE" } }),
    currentTerm
      ? db.enrollment.count({
          where: { termId: currentTerm.id, status: "ENROLLED" },
        })
      : Promise.resolve(0),
    db.user.count({
      where: { isActive: true, roles: { some: { role: { key: "teacher" } } } },
    }),
    db.invitation.count({
      where: {
        roleKey: "teacher",
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    }),
    db.attendanceRecord.findFirst({ select: { id: true } }),
    db.invoice.findFirst({ select: { id: true } }),
    db.assessmentScore.findFirst({ select: { id: true } }),
  ]);
  return {
    setUp,
    students,
    enrolled,
    staff: teachers + teacherInvites,
    inUse: register !== null || invoice !== null || score !== null,
  };
}

export interface OwnerContact {
  firstName: string | null;
  name: string;
  email: string;
  phone: string | null;
  lastLoginAt: Date | null;
  invitePending: boolean;
}

/** The school's first owner, or the invited owner while the invitation is unaccepted. */
export async function ownerContact(db: Db): Promise<OwnerContact | null> {
  const user = await db.user.findFirst({
    where: { isActive: true, roles: { some: { role: { key: "owner" } } } },
    orderBy: { createdAt: "asc" },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      lastLoginAt: true,
    },
  });
  if (user?.email) {
    return {
      firstName: user.firstName,
      name: `${user.firstName} ${user.lastName}`.trim(),
      email: user.email,
      phone: user.phone,
      lastLoginAt: user.lastLoginAt,
      invitePending: false,
    };
  }
  const invite = await db.invitation.findFirst({
    where: { roleKey: "owner", acceptedAt: null },
    orderBy: { createdAt: "desc" },
    select: { email: true, phone: true, firstName: true, lastName: true },
  });
  if (!invite?.email) return null;
  return {
    firstName: invite.firstName,
    name:
      `${invite.firstName ?? ""} ${invite.lastName ?? ""}`.trim() ||
      invite.email,
    email: invite.email,
    phone: invite.phone,
    lastLoginAt: null,
    invitePending: true,
  };
}

/** Resend's status for a reminder, from the webhook. Delivered never overwrites a bounce or complaint. */
export async function applyActivationWebhook(
  db: Db,
  schoolId: string,
  providerId: string,
  status: "DELIVERED" | "BOUNCED" | "COMPLAINED",
): Promise<boolean> {
  const row = await db.activationEmail.findFirst({
    where: { schoolId, providerId },
    select: { id: true, status: true },
  });
  if (!row) return false;
  if (status === "DELIVERED" && row.status !== "SENT") return true;
  await db.activationEmail.update({
    where: { id: row.id },
    data: {
      status,
      ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
    },
  });
  return true;
}

@Injectable()
export class ActivationService {
  private readonly logger = new Logger(ActivationService.name);

  constructor(private readonly email: EmailService) {}

  // Daily at 07:41 UTC (08:41 in Lagos), so reminders arrive in the morning.
  @Cron("41 7 * * *")
  async cron(): Promise<void> {
    try {
      const sent = await this.sendDue();
      if (sent > 0) this.logger.log(`Setup reminders: sent ${sent}`);
    } catch (err) {
      this.logger.error(
        `Setup reminders failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Sends every reminder that is due. `schoolIds` scopes the sweep for tests.
   * Returns how many were sent.
   */
  async sendDue(now: Date = new Date(), schoolIds?: string[]): Promise<number> {
    if (!this.email.isConfigured) return 0;
    const schools = await basePrisma.school.findMany({
      where: {
        suspendedAt: null,
        setupEmailsStoppedAt: null,
        createdAt: { lte: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) },
        ...(schoolIds?.length ? { id: { in: schoolIds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
      },
    });

    let sent = 0;
    let catchUp = 0;
    for (const school of schools) {
      try {
        const result = await this.sendForSchool(
          school,
          now,
          catchUp < MAX_CATCH_UP_PER_RUN,
        );
        if (result === "sent-catch-up") catchUp++;
        if (result !== "none") sent++;
      } catch (err) {
        this.logger.warn(
          `Setup reminder for school ${school.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return sent;
  }

  private async sendForSchool(
    school: {
      id: string;
      name: string;
      slug: string;
      status: string;
      createdAt: Date;
    },
    now: Date,
    catchUpAllowed: boolean,
  ): Promise<"none" | "sent" | "sent-catch-up"> {
    const plan = await withTenant(school.id, async (db) => {
      const counts = await schoolCounts(db, school.status === "ACTIVE");
      const stage = activationStage(counts);
      const rows = await db.activationEmail.findMany({
        select: { kind: true, sentAt: true, status: true },
      });
      const sentRows = rows
        .filter((r) => r.status !== "FAILED")
        .map((r) => ({
          kind: r.kind as ActivationEmailKind,
          sentAt: r.sentAt,
        }));
      const next = nextActivationEmail({
        stage,
        signedUpAt: school.createdAt,
        stopped: false,
        sent: sentRows,
        now,
      });
      if (!next) return null;
      // A school that signed up long before reminders existed is catching up:
      // its FIRST is overdue by more than a week. Those go a few a day.
      const catchUp =
        next.kind === "FIRST" &&
        now.getTime() - next.dueAt.getTime() > 7 * 24 * 60 * 60 * 1000;
      if (catchUp && !catchUpAllowed) return null;
      const owner = await ownerContact(db);
      // An invited owner cannot sign in to follow the links yet; the platform
      // admin resends the invitation instead.
      if (!owner || owner.invitePending) return null;
      if (await isSuppressedForAll(db, school.id, owner.email)) return null;
      const row = await db.activationEmail.upsert({
        where: { schoolId_kind: { schoolId: school.id, kind: next.kind } },
        create: {
          schoolId: school.id,
          kind: next.kind,
          toEmail: owner.email.toLowerCase(),
          stageAtSend: stage,
          sentAt: now,
        },
        update: {
          toEmail: owner.email.toLowerCase(),
          stageAtSend: stage,
          sentAt: now,
          status: "SENT",
          providerId: null,
        },
        select: { id: true },
      });
      return { id: row.id, kind: next.kind, stage, owner, catchUp };
    });
    if (!plan) return "none";

    const links = Object.fromEntries(
      ACTIVATION_LINK_TARGETS.map((t) => [t, clickUrl(school.id, plan.id, t)]),
    ) as Record<ActivationLinkTarget, string>;
    const stop = stopUrl(school.id, plan.id);
    let providerId: string | null = null;
    let status: ActivationEmailStatus = "SENT";
    try {
      [providerId] = await this.email.sendBatch(
        [
          {
            to: plan.owner.email,
            subject: reminderStep(plan.kind, plan.stage, school.name).subject,
            html: reminderEmailHtml({
              kind: plan.kind,
              stage: plan.stage,
              schoolName: school.name,
              ownerFirstName: plan.owner.firstName,
              links,
              stop,
            }),
            headers: {
              "List-Unsubscribe": `<${stop}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
            tags: [
              { name: "school", value: school.id },
              { name: "stream", value: "activation" },
            ],
          },
        ],
        { purpose: "activation-reminder" },
      );
    } catch {
      status = "FAILED";
    }

    await withTenant(school.id, async (db) => {
      await db.activationEmail.update({
        where: { id: plan.id },
        data: { providerId, status },
      });
      if (status === "SENT") {
        // The audit row names the reminder and the stage, never the address.
        await db.auditLog.create({
          data: {
            schoolId: school.id,
            userId: null,
            action: ACTIVATION_AUDIT.sent,
            entityType: "activation_email",
            entityId: plan.id,
            metadata: { kind: plan.kind, stage: plan.stage },
          },
        });
      }
    });
    if (status === "FAILED") return "none";
    return plan.catchUp ? "sent-catch-up" : "sent";
  }

  /**
   * A click on a reminder link: counts it and returns where to send the owner.
   * A link that does not verify goes to the staff sign-in, counting nothing.
   */
  async click(
    schoolId: string,
    emailId: string,
    target: string,
    sig: string,
  ): Promise<string> {
    const fallback = staffSiteUrl(null, "/login");
    if (!linkSignatureValid(schoolId, emailId, target, sig)) return fallback;
    const school = await basePrisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, slug: true, status: true },
    });
    if (!school) return fallback;
    const stage = await withTenant(schoolId, async (db) => {
      const updated = await db.activationEmail.updateMany({
        where: { id: emailId },
        data: { clickCount: { increment: 1 } },
      });
      if (updated.count > 0) {
        await db.activationEmail.updateMany({
          where: { id: emailId, firstClickedAt: null },
          data: { firstClickedAt: new Date() },
        });
      }
      return activationStage(
        await schoolCounts(db, school.status === "ACTIVE"),
      );
    });
    return targetUrl(
      school.slug,
      target as ActivationLinkTarget,
      stage as ActivationStage,
    );
  }

  /** "Stop these emails": stamps the school, once. False when the link does not verify. */
  async stop(schoolId: string, emailId: string, sig: string): Promise<boolean> {
    if (!stopSignatureValid(schoolId, emailId, sig)) return false;
    const updated = await basePrisma.school.updateMany({
      where: { id: schoolId, setupEmailsStoppedAt: null },
      data: { setupEmailsStoppedAt: new Date() },
    });
    if (updated.count === 0) {
      return (await basePrisma.school.count({ where: { id: schoolId } })) > 0;
    }
    await withTenant(schoolId, (db) =>
      db.auditLog.create({
        data: {
          schoolId,
          userId: null,
          action: ACTIVATION_AUDIT.stopped,
          entityType: "activation_email",
          entityId: emailId,
        },
      }),
    );
    return true;
  }
}
