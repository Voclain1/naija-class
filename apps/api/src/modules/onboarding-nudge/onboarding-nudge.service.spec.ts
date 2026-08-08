import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import type { EmailService } from "../../common/email/email.service.js";
import { AuthService } from "../auth/auth.service.js";
import { buildOnboardingNudgeHtml, OnboardingNudgeService } from "./onboarding-nudge.service.js";

// Mirrors finance.service.spec.ts's stub shape. isConfigured defaults true
// here (unlike FinanceService's false default) since every test in this
// file is specifically exercising the send path or its absence — there is
// no "channel not configured" branch in OnboardingNudgeService to protect.
function makeEmailStub(overrides: Partial<EmailService> = {}): EmailService {
  return { isConfigured: true, send: vi.fn(async () => undefined), ...overrides } as EmailService;
}

function makeService(overrides?: { email?: Partial<EmailService> }) {
  const emailStub = makeEmailStub(overrides?.email);
  return { svc: new OnboardingNudgeService(emailStub), emailStub };
}

// Integration spec — real DB via withTenant/basePrisma, same shape as
// finance.service.spec.ts and partition.service.spec.ts. Each test creates
// its own isolated school so there's no cross-test pollution.
describe("OnboardingNudgeService (integration)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  let phoneCounter = 0;
  function randomPhone(): string {
    phoneCounter += 1;
    const r = Math.floor(Math.random() * 100_000_000)
      .toString()
      .padStart(8, "0");
    return `+23484${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
  }

  // Signs up a real owner (same as FinanceService's makeSchool), fast-
  // forwards it past the wizard, and backdates its "onboarding.complete"
  // audit row (the same row applyStep5 writes in production) to simulate
  // however long ago the school actually finished onboarding. Optionally
  // seeds an AcademicYear/Student to simulate real post-wizard activity,
  // and optionally pre-sets onboardingNudgeSentAt to simulate an already-
  // nudged school.
  async function makeCompletedSchool(
    suffix: string,
    opts: {
      completedHoursAgo: number;
      withAcademicYear?: boolean;
      withStudent?: boolean;
      nudgeSentAt?: Date;
    },
  ): Promise<{ schoolId: string; ownerEmail: string; ownerFirstName: string; schoolName: string }> {
    const schoolName = `Nudge ${suffix} ${runId}`;
    const ownerEmail = `nudge-${suffix}-${runId}@example.test`;
    const ownerFirstName = "Nudge";

    const signed = await auth.signupOwner(
      {
        schoolName,
        schoolSlug: `nudge-${suffix}-${runId}`,
        ownerFirstName,
        ownerLastName: "Owner",
        ownerEmail,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "test" },
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);

    await basePrisma.school.update({
      where: { id: schoolId },
      data: {
        status: "ACTIVE",
        onboardingStep: 5,
        onboardingNudgeSentAt: opts.nudgeSentAt ?? null,
      },
    });

    const completedAt = new Date(Date.now() - opts.completedHoursAgo * 60 * 60 * 1000);

    await withTenant(schoolId, async (db) => {
      await db.auditLog.create({
        data: {
          schoolId,
          userId: signed.user.id,
          action: "onboarding.complete",
          entityType: "school",
          entityId: schoolId,
          metadata: { completedAt: completedAt.toISOString() },
          createdAt: completedAt,
        },
      });

      if (opts.withAcademicYear) {
        await db.academicYear.create({
          data: {
            schoolId,
            label: `2025/2026-nudge-${runId}-${Math.random().toString(36).slice(2, 6)}`,
            startDate: new Date("2025-09-01"),
            endDate: new Date("2026-07-31"),
          },
        });
      }

      if (opts.withStudent) {
        await db.student.create({
          data: {
            schoolId,
            admissionNumber: `ADM-NUDGE-${runId}-${Math.random().toString(36).slice(2, 6)}`,
            firstName: "Test",
            lastName: "Student",
            dateOfBirth: new Date("2010-01-01"),
            gender: "FEMALE",
          },
        });
      }
    });

    return { schoolId, ownerEmail, ownerFirstName, schoolName };
  }

  // ── (a) eligible ─────────────────────────────────────────────────────────

  it("(a) eligible school (24h+ old, zero academic years, zero students) — sends the email and stamps onboardingNudgeSentAt", async () => {
    const { svc, emailStub } = makeService();
    const { schoolId, ownerEmail, schoolName } = await makeCompletedSchool("eligible", {
      completedHoursAgo: 30,
    });

    await svc.sendPendingNudges([schoolId]);

    expect(emailStub.send).toHaveBeenCalledTimes(1);
    const call = (emailStub.send as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.to).toBe(ownerEmail);
    expect(call.subject).toContain("3 quick steps to go");
    expect(call.html).toContain(schoolName);

    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { onboardingNudgeSentAt: true },
    });
    expect(school.onboardingNudgeSentAt).not.toBeNull();
  });

  // ── (b) already has an academic year ─────────────────────────────────────

  it("(b) school already has an academic year — skipped, not sent, onboardingNudgeSentAt stays null", async () => {
    const { svc, emailStub } = makeService();
    const { schoolId } = await makeCompletedSchool("has-year", {
      completedHoursAgo: 30,
      withAcademicYear: true,
    });

    await svc.sendPendingNudges([schoolId]);

    expect(emailStub.send).not.toHaveBeenCalled();
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { onboardingNudgeSentAt: true },
    });
    expect(school.onboardingNudgeSentAt).toBeNull();
  });

  // ── (c) already has a student ────────────────────────────────────────────

  it("(c) school already has a student — skipped, not sent, onboardingNudgeSentAt stays null", async () => {
    const { svc, emailStub } = makeService();
    const { schoolId } = await makeCompletedSchool("has-student", {
      completedHoursAgo: 30,
      withStudent: true,
    });

    await svc.sendPendingNudges([schoolId]);

    expect(emailStub.send).not.toHaveBeenCalled();
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { onboardingNudgeSentAt: true },
    });
    expect(school.onboardingNudgeSentAt).toBeNull();
  });

  // ── (d) already nudged ────────────────────────────────────────────────────

  it("(d) onboardingNudgeSentAt already set — skipped entirely, not resent", async () => {
    const { svc, emailStub } = makeService();
    const alreadySentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const { schoolId } = await makeCompletedSchool("already-sent", {
      completedHoursAgo: 30,
      nudgeSentAt: alreadySentAt,
    });

    await svc.sendPendingNudges([schoolId]);

    expect(emailStub.send).not.toHaveBeenCalled();
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { onboardingNudgeSentAt: true },
    });
    // Unchanged — proves this school was never re-evaluated, not just that
    // the timestamp happens to still be non-null.
    expect(school.onboardingNudgeSentAt?.getTime()).toBe(alreadySentAt.getTime());
  });

  // ── (e) too recent ───────────────────────────────────────────────────────

  it("(e) onboarding.complete audit row younger than 24h — skipped, not sent yet", async () => {
    const { svc, emailStub } = makeService();
    const { schoolId } = await makeCompletedSchool("too-recent", {
      completedHoursAgo: 1,
    });

    await svc.sendPendingNudges([schoolId]);

    expect(emailStub.send).not.toHaveBeenCalled();
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { onboardingNudgeSentAt: true },
    });
    expect(school.onboardingNudgeSentAt).toBeNull();
  });

  // ── (f) EmailService throws ──────────────────────────────────────────────

  it("(f) EmailService throws for one school — still stamps onboardingNudgeSentAt (one-shot, no retry storm), and a second school in the same sweep still sends normally", async () => {
    const { svc, emailStub } = makeService({
      email: { send: vi.fn().mockRejectedValueOnce(new Error("Resend is down")) },
    });
    const failing = await makeCompletedSchool("email-fails", { completedHoursAgo: 30 });
    const healthy = await makeCompletedSchool("email-ok", { completedHoursAgo: 30 });

    await expect(
      svc.sendPendingNudges([failing.schoolId, healthy.schoolId]),
    ).resolves.toBeUndefined();

    expect(emailStub.send).toHaveBeenCalledTimes(2);

    const failingSchool = await basePrisma.school.findUniqueOrThrow({
      where: { id: failing.schoolId },
      select: { onboardingNudgeSentAt: true },
    });
    expect(failingSchool.onboardingNudgeSentAt).not.toBeNull();

    const healthySchool = await basePrisma.school.findUniqueOrThrow({
      where: { id: healthy.schoolId },
      select: { onboardingNudgeSentAt: true },
    });
    expect(healthySchool.onboardingNudgeSentAt).not.toBeNull();
  });

  // ── Email content ─────────────────────────────────────────────────────────

  it("buildOnboardingNudgeHtml includes all three step links", () => {
    const html = buildOnboardingNudgeHtml({ ownerFirstName: "Ada", schoolName: "Ada's School" });
    expect(html).toContain("Ada");
    expect(html).toContain("Ada's School");
    expect(html).toContain("/settings/academic/years");
    expect(html).toContain("/staff/invite");
    expect(html).toContain("/students");
  });

  // ── onModuleInit ──────────────────────────────────────────────────────────

  describe("onModuleInit — non-fatal on DB failure or timeout", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("resolves (never throws) and logs a warning when the sweep rejects", async () => {
      const { svc } = makeService();
      const dbError = new Error("connection terminated unexpectedly");
      vi.spyOn(svc, "sendPendingNudges").mockRejectedValueOnce(dbError);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const warnSpy = vi.spyOn((svc as any).logger, "warn");

      await expect(svc.onModuleInit()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toContain("connection terminated unexpectedly");
    });

    it("resolves within the timeout ceiling (never hangs) when the sweep never settles", async () => {
      const { svc } = makeService();
      vi.spyOn(svc, "sendPendingNudges").mockReturnValueOnce(
        new Promise(() => {
          /* never resolves — simulates a saturated connection pool at startup */
        }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const warnSpy = vi.spyOn((svc as any).logger, "warn");

      const start = Date.now();
      await expect(svc.onModuleInit()).resolves.toBeUndefined();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(9900);
      expect(elapsed).toBeLessThan(13000);
      expect(warnSpy.mock.calls[0]![0]).toContain("timed out");
    });
  });
});
