import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";

import { EmailService } from "../../common/email/email.service.js";
import { redactEmail } from "../../common/redact.js";

// onModuleInit must never block NestFactory.create() indefinitely — same
// reasoning as FinanceService.transitionOverdueInvoices and
// PartitionService.createNextMonthPartitions: this sweep loops every
// ACTIVE-but-not-yet-nudged school, so it gets the same 10s headroom as the
// other school-looping cron rather than PartitionService's 5s (3 fixed
// calls, no loop).
const ON_MODULE_INIT_TIMEOUT_MS = 10000;

// A school is nudge-eligible once its "onboarding.complete" audit row (the
// same one advanceOnboarding's step 5 writes) is at least this old. 24h,
// not the plan's full 24-48h window — the cron itself runs once daily, so
// a 24h floor plus up-to-a-day-of-cron-jitter already lands most sends
// inside 24-48h without a second threshold to reason about.
const NUDGE_ELIGIBLE_AFTER_MS = 24 * 60 * 60 * 1000;

// Same "duplicate rather than import a three-line helper" call as
// AuthService/PlatformAdminService's webBaseUrl() — no shared module either
// sibling already reaches into (see platform-admin.service.ts's comment on
// its own copy for the fuller rationale).
function webBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? "http://localhost:3001";
}

// ---------------------------------------------------------------------------
// OnboardingNudgeService — daily cron, one-time "come back and finish
// setting up" email.
//
// Trigger (see docs/deferred.md-adjacent plan-first note, and the platform-
// admin funnel investigation this was scoped from): status ACTIVE (finished
// the 5-step wizard), onboardingNudgeSentAt still null, the school's
// "onboarding.complete" audit row is 24h+ old, and it has zero AcademicYear
// rows AND zero Student rows. Deliberately NOT gated on class-arm existence
// — class arms are auto-seeded (14 per school) the instant a school
// completes signup, so arm count is never a real engagement signal
// post-auto-arm-fix; using it would false-negative on every real school.
//
// One email, one time, full stop (v1) — onboardingNudgeSentAt is stamped
// right after the send attempt (success or logged failure), never reset,
// no second nudge tier. See the approved plan-first: this is an unproven
// mechanism, and a multi-stage nudge state machine isn't worth building
// before knowing the first email even helps.
@Injectable()
export class OnboardingNudgeService implements OnModuleInit {
  private readonly logger = new Logger(OnboardingNudgeService.name);

  constructor(private readonly email: EmailService) {}

  async onModuleInit() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.sendPendingNudges(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${ON_MODULE_INIT_TIMEOUT_MS}ms`)),
            ON_MODULE_INIT_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OnboardingNudgeService.onModuleInit failed (non-fatal): ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // Runs daily at 00:15 UTC — offset from the partition cron (20th @
  // midnight) and the OVERDUE-invoice cron (00:05) so the three don't pile
  // up on the same tick.
  //
  // schoolIds is an optional allow-list used by tests to scope the sweep to
  // one fixture school, same convention as
  // FinanceService.transitionOverdueInvoices. The production @Cron call
  // passes nothing → every ACTIVE, not-yet-nudged school is swept.
  @Cron("15 0 * * *")
  async sendPendingNudges(schoolIds?: string[]): Promise<void> {
    let schools: Array<{ id: string; name: string }>;
    try {
      schools = await basePrisma.school.findMany({
        where: {
          status: "ACTIVE",
          onboardingNudgeSentAt: null,
          ...(schoolIds?.length ? { id: { in: schoolIds } } : {}),
        },
        select: { id: true, name: true },
      });
    } catch (err) {
      this.logger.error(`Onboarding nudge cron: failed to list schools: ${String(err)}`);
      return;
    }

    let sentCount = 0;

    for (const school of schools) {
      try {
        const sent = await this.maybeSendNudge(school.id, school.name);
        if (sent) sentCount++;
      } catch (err) {
        this.logger.error(`Onboarding nudge cron: school ${school.id} failed: ${String(err)}`);
      }
    }

    if (sentCount > 0) {
      this.logger.log(`Onboarding nudge: sent to ${sentCount} school(s)`);
    }
  }

  // Returns true iff an email was actually dispatched (for the sentCount
  // log above) — false covers "not eligible yet" as well as "eligible but
  // no owner email on file", both of which still leave onboardingNudgeSentAt
  // untouched or stamped as appropriate, see inline comments.
  private async maybeSendNudge(schoolId: string, schoolName: string): Promise<boolean> {
    return withTenant(schoolId, async (db) => {
      const completedAudit = await db.auditLog.findFirst({
        where: { schoolId, action: "onboarding.complete" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      // No completion audit row at all shouldn't happen for an ACTIVE
      // school (applyStep5 writes it in the same transaction as the status
      // flip) — treat defensively as "not yet eligible" rather than crash
      // the sweep for every other school.
      if (!completedAudit) return false;
      const eligibleAt = completedAudit.createdAt.getTime() + NUDGE_ELIGIBLE_AFTER_MS;
      if (Date.now() < eligibleAt) return false;

      const [academicYearCount, studentCount] = await Promise.all([
        db.academicYear.count(),
        db.student.count(),
      ]);
      // Real activity happened — this school was never going to be nudged.
      // Deliberately leave onboardingNudgeSentAt untouched (not "sent",
      // just never became eligible) so this stays a correct, if slightly
      // wasteful, re-check on future runs rather than conflating "no email
      // needed" with "email sent" in the one dedup field we have.
      if (academicYearCount > 0 || studentCount > 0) return false;

      const owner = await db.user.findFirst({
        where: { roles: { some: { role: { key: "owner" } } } },
        select: { email: true, firstName: true },
      });

      // Stamp unconditionally past this point — one-shot semantics. A
      // missing owner email or a Resend outage shouldn't retry this school
      // forever; the failure is logged instead.
      await db.school.update({
        where: { id: schoolId },
        data: { onboardingNudgeSentAt: new Date() },
      });

      if (!owner?.email) {
        this.logger.warn(
          `Onboarding nudge: school ${schoolId} has no owner email on file — marked sent, nothing dispatched`,
        );
        return false;
      }

      try {
        await this.email.send({
          to: owner.email,
          subject: "Your school isn't set up yet — 3 quick steps to go",
          html: buildOnboardingNudgeHtml({
            ownerFirstName: owner.firstName,
            schoolName,
          }),
        });
        return true;
      } catch (err) {
        this.logger.warn(
          `Onboarding nudge email failed for ${redactEmail(owner.email)}: ${String(err)}`,
        );
        return false;
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Email template helper — same inline-style, table-based shape as
// finance.service.ts's buildReminderHtml, exported so the spec can assert
// on its content directly without re-deriving the HTML.
// ---------------------------------------------------------------------------

export function buildOnboardingNudgeHtml(opts: {
  ownerFirstName: string;
  schoolName: string;
}): string {
  const base = webBaseUrl();
  const btn = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;padding:8px 16px;background:#0E5C43;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:600">${label}</a>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Finish setting up ${opts.schoolName}</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a1a">${opts.schoolName}</h2>
  <p>Hi ${opts.ownerFirstName},</p>
  <p>You created <strong>${opts.schoolName}</strong> on School Kit a day ago — nice start! You haven't added an academic year, students, or a teacher yet, so most of the platform is still empty. It only takes a few minutes to get moving:</p>
  <table style="border-collapse:collapse;width:100%">
    <tr><td style="padding:12px 0 4px">1. Add your current academic year</td></tr>
    <tr><td style="padding:0 0 16px">${btn(`${base}/settings/academic/years`, "Add academic year")}</td></tr>
    <tr><td style="padding:12px 0 4px">2. Invite a teacher or admin</td></tr>
    <tr><td style="padding:0 0 16px">${btn(`${base}/staff/invite`, "Invite staff")}</td></tr>
    <tr><td style="padding:12px 0 4px">3. Add your students (one at a time, in bulk, or from a CSV)</td></tr>
    <tr><td style="padding:0 0 16px">${btn(`${base}/students`, "Add students")}</td></tr>
  </table>
  <p>Your class arms are already set up automatically — one per class level — so you can skip straight to adding students once you've got a year in place.</p>
  <p>Questions? Just reply to this email.</p>
  <p style="color:#6b7280;font-size:13px">This message was sent by School Kit because ${opts.schoolName} finished setup but hasn't added an academic year or students yet.</p>
</body>
</html>`;
}
