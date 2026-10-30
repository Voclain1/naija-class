import { Injectable } from "@nestjs/common";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  activationStage,
  isStuck,
  type ActivationEmailKind,
  type ActivationEmailStatus,
  type ActivationStage,
  type PlatformActivationDto,
  type PlatformActivationSchoolDto,
} from "@school-kit/types";

import { ownerContact, schoolCounts } from "./activation.service.js";

// Getting started in the platform admin (docs/modules/activation.md):
// PlatformAdminGuard only. basePrisma reads `schools` (no RLS); each school's
// counts, owner and reminders are read under its own GUC through withTenant,
// so no SECURITY DEFINER function is needed (count stays 23). The owner's name,
// email and phone are shown on every row, by the owner's decision (2026-10-30).
@Injectable()
export class ActivationPlatformService {
  // The sweep reads every school, one at a time, and keeps the answer for five
  // minutes. One at a time because the pool holds three connections for the
  // whole API: a sweep that took all three would stall every other request
  // for its length. Concurrent callers share one sweep.
  private cached: { at: number; data: PlatformActivationDto } | null = null;
  private running: Promise<PlatformActivationDto> | null = null;

  static readonly CACHE_MS = 5 * 60 * 1000;

  /** The cached sweep, or a new one when it is older than five minutes or `fresh` is asked. */
  async list(opts: { fresh?: boolean } = {}): Promise<PlatformActivationDto> {
    if (!opts.fresh && this.cached && Date.now() - this.cached.at < ActivationPlatformService.CACHE_MS) return this.cached.data;
    if (!this.running) {
      this.running = this.sweep()
        .then((data) => {
          this.cached = { at: Date.now(), data };
          return data;
        })
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  /** Every school (or `schoolIds`, for tests), read now. */
  async sweep(now: Date = new Date(), schoolIds?: string[]): Promise<PlatformActivationDto> {
    const schools = await basePrisma.school.findMany({
      ...(schoolIds?.length ? { where: { id: { in: schoolIds } } } : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        setupEmailsStoppedAt: true,
        onboardingCallBookedAt: true,
      },
      take: 2000,
    });
    const rows: PlatformActivationSchoolDto[] = [];
    for (const school of schools) rows.push(await this.one(school, now));
    return { generatedAt: now.toISOString(), summary: summarise(rows), schools: rows };
  }

  private one(
    school: {
      id: string;
      name: string;
      slug: string;
      status: string;
      createdAt: Date;
      setupEmailsStoppedAt: Date | null;
      onboardingCallBookedAt: Date | null;
    },
    now: Date,
  ): Promise<PlatformActivationSchoolDto> {
    return withTenant(school.id, async (db) => {
      const counts = await schoolCounts(db, school.status === "ACTIVE");
      const stage = activationStage(counts);
      const [owner, emails] = await Promise.all([
        ownerContact(db),
        db.activationEmail.findMany({
          orderBy: { sentAt: "asc" },
          select: {
            kind: true,
            sentAt: true,
            status: true,
            clickCount: true,
            firstClickedAt: true,
            stageAtSend: true,
          },
        }),
      ]);
      const latest = emails.filter((e) => e.status !== "FAILED").at(-1);
      return {
        schoolId: school.id,
        name: school.name,
        slug: school.slug,
        signedUpAt: school.createdAt.toISOString(),
        stage,
        stuck: isStuck(stage, school.createdAt, now),
        students: counts.students,
        enrolled: counts.enrolled,
        staff: counts.staff,
        owner: owner
          ? {
              name: owner.name,
              email: owner.email,
              phone: owner.phone,
              lastLoginAt: owner.lastLoginAt?.toISOString() ?? null,
              invitePending: owner.invitePending,
            }
          : null,
        setupCallBooked: school.onboardingCallBookedAt !== null,
        emailsStopped: school.setupEmailsStoppedAt !== null,
        emails: emails.map((e) => ({
          kind: e.kind as ActivationEmailKind,
          sentAt: e.sentAt.toISOString(),
          status: e.status as ActivationEmailStatus,
          clickCount: e.clickCount,
          firstClickedAt: e.firstClickedAt?.toISOString() ?? null,
          stageAtSend: e.stageAtSend as ActivationStage,
        })),
        movedSinceEmail: latest ? stage > latest.stageAtSend : null,
      } satisfies PlatformActivationSchoolDto;
    });
  }
}

export function summarise(
  rows: PlatformActivationSchoolDto[],
): PlatformActivationDto["summary"] {
  const byStage = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } as Record<
    ActivationStage,
    number
  >;
  let emailsSent = 0;
  let emailsDelivered = 0;
  let emailsClicked = 0;
  let schoolsEmailed = 0;
  let schoolsMovedAfterEmail = 0;
  for (const r of rows) {
    byStage[r.stage]++;
    const sent = r.emails.filter((e) => e.status !== "FAILED");
    emailsSent += sent.length;
    emailsDelivered += sent.filter((e) => e.status === "DELIVERED").length;
    emailsClicked += sent.filter((e) => e.clickCount > 0).length;
    if (sent.length > 0) {
      schoolsEmailed++;
      // Moved on from where it was when the FIRST reminder went.
      if (r.stage > sent[0]!.stageAtSend) schoolsMovedAfterEmail++;
    }
  }
  return {
    schools: rows.length,
    byStage,
    stuck: rows.filter((r) => r.stuck).length,
    emailsSent,
    emailsDelivered,
    emailsClicked,
    schoolsEmailed,
    schoolsMovedAfterEmail,
    emailsStopped: rows.filter((r) => r.emailsStopped).length,
  };
}
