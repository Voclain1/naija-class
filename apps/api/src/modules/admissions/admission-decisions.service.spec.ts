import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, sickbayDayOf, type SubmitAdmissionInput } from "@school-kit/types";

import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";
import { AuthService } from "../auth/auth.service";
import type { EventNotification } from "../notifications/notification-dispatch.service";
import { AdmissionAlertsService } from "./admission-alerts.service";
import { AdmissionDecisionsService } from "./admission-decisions.service";
import { AdmissionMailService } from "./admission-mail.service";
import { admissionTrackingToken } from "./admission-tracking";
import { AdmissionsPublicService } from "./admissions-public.service";
import { AdmissionsPurgeService } from "./admissions-purge.service";
import { AdmissionsSettingsService } from "./admissions-settings.service";
import { AdmissionsService } from "./admissions.service";
import { hashToken } from "./admissions.shared";

// Phase 9 / CP7.2 — review, assessment, offer and admitting (docs/modules/
// phase-9.md §16 CP7-D4, D5; owner's answers §16.8), against real Postgres
// and a real filesystem store.
//
// The rules first: statuses move only forward, and two people acting at once
// cannot both succeed; each step sends the family its one email, with the
// tracking link; the family accepts or withdraws on the tracking page, which
// shows the letter in full; an officer takes an application as far as an
// accepted offer, and only owner and admin admit. Admit creates exactly one
// student, enrolment and guardian link in ONE transaction, honours the
// admission-number rule and the plan's cap, links an existing guardian with
// the same email, and leaves nothing behind when it fails. Open applications
// are closed after 12 months.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const tomorrow = sickbayDayOf(new Date(Date.now() + 24 * 60 * 60 * 1000));

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

class FakeDispatch {
  calls: EventNotification[] = [];
  async notifyOfEvent(req: EventNotification) {
    this.calls.push(req);
    return "PUSH" as const;
  }
}
class FakeEmail {
  isConfigured = true;
  sent: { to: string; subject: string; html: string }[] = [];
  async send(m: { to: string; subject: string; html: string }) {
    this.sent.push({ to: m.to, subject: m.subject, html: m.html });
  }
}
class FakeTermii {
  isConfigured = true;
  async sendSms() {}
}

interface Fixture {
  schoolId: string;
  slug: string;
  ownerId: string;
  adminId: string;
  officerId: string;
  teacherId: string;
  levelId: string;
  levelCode: string;
  termId: string;
  armId: string;
}

describe("Admission decisions (integration)", () => {
  const storageRoot = mkdtempSync(join(tmpdir(), "admission-decisions-"));
  const storage = new StorageService(new FilesystemStorageDriver(storageRoot));
  const email = new FakeEmail();
  const alerts = new AdmissionAlertsService(new FakeDispatch() as never, email as never, new FakeTermii() as never);
  const mail = new AdmissionMailService(email as never);
  const pub = new AdmissionsPublicService(storage, email as never, alerts, mail);
  const staff = new AdmissionsService(storage);
  const settings = new AdmissionsSettingsService();
  const decisions = new AdmissionDecisionsService(mail);
  const purge = new AdmissionsPurgeService(storage, mail);
  const schoolIds = new Set<string>();
  let A: Fixture;
  let B: Fixture;
  let n = 0;

  async function setUp(label: string): Promise<Fixture> {
    const slug = `adx-${label}-${runId}`;
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Decisions ${label} ${runId}`,
        schoolSlug: slug,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `adx-${label}-${runId}@example.test`,
        ownerPhone: `+23495${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });
    const f = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({ data: { schoolId, label: `Y-${runId}`, startDate: day("2025-09-01"), endDate: day("2099-07-31") } });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "This Term", startDate: day("2025-09-01"), endDate: day("2098-12-31"), isCurrent: true },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true, code: true } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "Primary 1A", code: `adx-${label}-${runId}` } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staffUser = async (key: string, tag = key) => {
        const user = await db.user.create({ data: { schoolId, email: `adx-${label}-${tag}-${runId}@example.test`, firstName: tag, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(key) } });
        return user.id;
      };
      return {
        schoolId,
        slug,
        ownerId: signed.user.id,
        adminId: await staffUser("admin"),
        officerId: await staffUser("teacher", "officer"),
        teacherId: await staffUser("teacher"),
        levelId: level.id,
        levelCode: level.code,
        termId: term.id,
        armId: arm.id,
      };
    });
    // The officer is a teacher with the extra Admissions officer role.
    await settings.setOfficers(ctx(schoolId, f.adminId), { userIds: [f.officerId] }, reqCtx);
    return f;
  }

  function form(f: Fixture, overrides: Partial<SubmitAdmissionInput> = {}): SubmitAdmissionInput {
    n += 1;
    return {
      classLevelId: f.levelId,
      child: { firstName: "Chidera", lastName: `Eze${n}${runId}`, dateOfBirth: "2018-05-02", gender: "MALE" },
      guardian: { firstName: "Amaka", lastName: "Eze", relationship: "MOTHER", phone: "08031234567", email: `Family${n}-${runId}@Example.test` },
      homeAddress: "4 Allen Avenue, Ikeja",
      answers: {},
      consent: true,
      ...overrides,
    };
  }

  /** One application through the public form; returns its id and the family's token. */
  async function apply(f: Fixture, overrides: Partial<SubmitAdmissionInput> = {}) {
    const { reference } = await pub.submit(f.slug, form(f, overrides), { PHOTO: PNG }, reqCtx);
    const app = await withTenant(f.schoolId, (db) => db.admissionApplication.findFirstOrThrow({ where: { reference }, select: { id: true, trackingTokenHash: true } }));
    const token = admissionTrackingToken(app.id);
    expect(hashToken(token)).toBe(app.trackingTokenHash);
    return { id: app.id, token, reference };
  }

  async function status(f: Fixture, id: string) {
    return withTenant(f.schoolId, async (db) => (await db.admissionApplication.findUniqueOrThrow({ where: { id } })).status);
  }

  async function toAccepted(f: Fixture, overrides: Partial<SubmitAdmissionInput> = {}) {
    const a = await apply(f, overrides);
    await decisions.offer(ctx(f.schoolId, f.officerId), a.id, { letter: "Fees: ₦150,000 a term.\nResumption: 8 January." }, reqCtx);
    await pub.acceptOffer(f.slug, a.token, reqCtx);
    return a;
  }

  beforeAll(async () => {
    A = await setUp("a");
    B = await setUp("b");
  });

  beforeEach(() => {
    email.sent = [];
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    rmSync(storageRoot, { recursive: true, force: true });
    await basePrisma.$disconnect();
  });

  // ── Statuses and the family's emails ─────────────────────────────────────

  it("every email carries the family's tracking link, derived and never stored", async () => {
    const a = await apply(A);
    const ack = email.sent.find((m) => m.subject.startsWith("Application received"))!;
    expect(ack.html).toContain(`/apply/${A.slug}/track/${a.token}`);
    email.sent = [];
    await decisions.bookAssessment(ctx(A.schoolId, A.officerId), a.id, { kind: "ENTRANCE_EXAM", day: tomorrow, time: "09:00" }, reqCtx);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.html).toContain(`/apply/${A.slug}/track/${a.token}`);
  });

  it("review, then the assessment: booked, then changed, each emailed once; the page shows it", async () => {
    const a = await apply(A);
    email.sent = [];
    await decisions.review(ctx(A.schoolId, A.officerId), a.id, reqCtx);
    expect(await status(A, a.id)).toBe("UNDER_REVIEW");
    expect(email.sent).toHaveLength(0);

    await decisions.bookAssessment(ctx(A.schoolId, A.officerId), a.id, { kind: "INTERVIEW", day: tomorrow, time: "10:30", note: "Bring a pencil." }, reqCtx);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.subject).toMatch(/^Interview for Chidera/);
    expect(email.sent[0]!.html).toContain("10:30");
    expect(email.sent[0]!.to).toBe(email.sent[0]!.to.toLowerCase());

    await decisions.bookAssessment(ctx(A.schoolId, A.officerId), a.id, { kind: "INTERVIEW", day: tomorrow, time: "11:00" }, reqCtx);
    expect(email.sent[1]!.subject).toMatch(/^Changed: Interview/);

    const track = await pub.track(A.slug, a.token);
    expect(track.decision.assessment).toMatchObject({ label: "Interview", time: "11:00", note: null });
    const detail = await staff.get(ctx(A.schoolId, A.officerId), a.id);
    expect(detail.decision.assessment).toMatchObject({ kind: "INTERVIEW", day: tomorrow, time: "11:00" });
  });

  it("refuses an assessment in the past", async () => {
    const a = await apply(A);
    await expect(decisions.bookAssessment(ctx(A.schoolId, A.adminId), a.id, { kind: "OTHER", day: "2020-01-01", time: "09:00" }, reqCtx)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("an offer carries its letter in full, by email and on the tracking page, and the family accepts there", async () => {
    const a = await apply(A);
    email.sent = [];
    const letter = "Fees: ₦150,000 a term.\nUniform: ₦20,000.\nAccept by 30 November.";
    await decisions.offer(ctx(A.schoolId, A.adminId), a.id, { letter }, reqCtx);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.html).toContain("Fees: ₦150,000 a term.<br>Uniform: ₦20,000.<br>Accept by 30 November.");

    const before = await pub.track(A.slug, a.token);
    expect(before.decision).toMatchObject({ offerLetter: letter, canAccept: true, canWithdraw: true });
    const after = await pub.acceptOffer(A.slug, a.token, reqCtx);
    expect(after.status).toBe("OFFER_ACCEPTED");
    expect(after.decision.canAccept).toBe(false);
    const detail = await staff.get(ctx(A.schoolId, A.adminId), a.id);
    expect(detail.decision.acceptedBy).toBe("The family, online");
    // Accepting twice is refused, not repeated.
    await expect(pub.acceptOffer(A.slug, a.token, reqCtx)).rejects.toBeInstanceOf(ConflictError);
  });

  it("the school records an acceptance, and says who did", async () => {
    const a = await apply(A);
    await decisions.offer(ctx(A.schoolId, A.adminId), a.id, { letter: "The letter." }, reqCtx);
    await decisions.recordAcceptance(ctx(A.schoolId, A.officerId), a.id, { familySawLetter: true }, reqCtx);
    const detail = await staff.get(ctx(A.schoolId, A.adminId), a.id);
    expect(detail.status).toBe("OFFER_ACCEPTED");
    expect(detail.decision.acceptedBy).toBe("officer Staff");
  });

  it("two people offering at once: exactly one succeeds", async () => {
    const a = await apply(A);
    const results = await Promise.allSettled([
      decisions.offer(ctx(A.schoolId, A.adminId), a.id, { letter: "First." }, reqCtx),
      decisions.offer(ctx(A.schoolId, A.officerId), a.id, { letter: "Second." }, reqCtx),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
  });

  it("moves only forward: an offered application cannot be put back under review", async () => {
    const a = await apply(A);
    await decisions.offer(ctx(A.schoolId, A.adminId), a.id, { letter: "L." }, reqCtx);
    await expect(decisions.review(ctx(A.schoolId, A.adminId), a.id, reqCtx)).rejects.toBeInstanceOf(ConflictError);
    await expect(decisions.bookAssessment(ctx(A.schoolId, A.adminId), a.id, { kind: "OTHER", day: tomorrow, time: "09:00" }, reqCtx)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("not successful: the school's note reaches the family only when typed", async () => {
    const plain = await apply(A);
    const noted = await apply(A);
    email.sent = [];
    await decisions.reject(ctx(A.schoolId, A.adminId), plain.id, {}, reqCtx);
    await decisions.reject(ctx(A.schoolId, A.adminId), noted.id, { note: "All places in Primary 1 are taken." }, reqCtx);
    expect(email.sent[0]!.html).toContain("unable to offer");
    expect(email.sent[0]!.html).not.toContain("places");
    expect(email.sent[1]!.html).toContain("All places in Primary 1 are taken.");
    const track = await pub.track(A.slug, noted.token);
    expect(track.decision).toMatchObject({ decisionNote: "All places in Primary 1 are taken.", canAccept: false, canWithdraw: false });
  });

  it("the family withdraws on the tracking page, and is told", async () => {
    const a = await apply(A);
    email.sent = [];
    const track = await pub.withdraw(A.slug, a.token, reqCtx);
    expect(track.status).toBe("WITHDRAWN");
    expect(email.sent[0]!.html).toContain("You have withdrawn");
    await expect(pub.withdraw(A.slug, a.token, reqCtx)).rejects.toBeInstanceOf(ConflictError);
  });

  it("the school withdraws one when the family asks", async () => {
    const a = await apply(A);
    email.sent = [];
    await decisions.withdraw(ctx(A.schoolId, A.officerId), a.id, reqCtx);
    expect(await status(A, a.id)).toBe("WITHDRAWN");
    expect(email.sent[0]!.html).toContain("as asked");
  });

  it("a tracking link opens only its own school's application", async () => {
    const a = await apply(A);
    await expect(pub.track(B.slug, a.token)).rejects.toBeInstanceOf(NotFoundError);
    await expect(pub.acceptOffer(B.slug, a.token, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("nothing the family typed reaches an audit row", async () => {
    const a = await apply(A);
    await decisions.reject(ctx(A.schoolId, A.adminId), a.id, { note: "SecretNote-xyz" }, reqCtx);
    const rows = await withTenant(A.schoolId, (db) => db.auditLog.findMany({ where: { entityId: a.id } }));
    expect(JSON.stringify(rows)).not.toMatch(/Chidera|Amaka|SecretNote|example\.test/i);
  });

  // ── Who ──────────────────────────────────────────────────────────────────

  it("a plain teacher is refused; an officer handles applications but cannot admit", async () => {
    const a = await toAccepted(A);
    await expect(decisions.review(ctx(A.schoolId, A.teacherId), a.id, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decisions.admit(ctx(A.schoolId, A.officerId), a.id, { termId: A.termId, classArmId: A.armId }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staff.studentDocuments(ctx(A.schoolId, A.officerId), A.armId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("another school's application is not found", async () => {
    const a = await apply(A);
    await expect(decisions.offer(ctx(B.schoolId, B.adminId), a.id, { letter: "L." }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
  });

  // ── Admit ────────────────────────────────────────────────────────────────

  it("admit creates one student, placed in the class, with the parent as primary guardian, in one go", async () => {
    const a = await toAccepted(A);
    const before = await staff.get(ctx(A.schoolId, A.adminId), a.id);
    expect(before.decision.existingGuardian).toBeNull();
    email.sent = [];
    const result = await decisions.admit(ctx(A.schoolId, A.adminId), a.id, { termId: A.termId, classArmId: A.armId, admissionNumber: `ADM-${runId}-1` }, reqCtx);
    expect(result).toMatchObject({ admissionNumber: `ADM-${runId}-1`, linkedExistingGuardian: false });

    const student = await withTenant(A.schoolId, (db) =>
      db.student.findUniqueOrThrow({
        where: { id: result.studentId },
        include: { enrollments: true, guardians: { include: { guardian: true } } },
      }),
    );
    expect(student).toMatchObject({ firstName: "Chidera", gender: "MALE", address: "4 Allen Avenue, Ikeja" });
    expect(student.dateOfBirth.toISOString().slice(0, 10)).toBe("2018-05-02");
    expect(student.enrollments).toHaveLength(1);
    expect(student.enrollments[0]).toMatchObject({ termId: A.termId, classArmId: A.armId });
    expect(student.guardians).toHaveLength(1);
    expect(student.guardians[0]).toMatchObject({ isPrimary: true, guardianId: result.guardianId });
    expect(student.guardians[0]!.guardian).toMatchObject({ firstName: "Amaka", relationship: "MOTHER" });

    const detail = await staff.get(ctx(A.schoolId, A.adminId), a.id);
    expect(detail.status).toBe("ADMITTED");
    expect(detail.decision.student).toMatchObject({ id: result.studentId, admissionNumber: `ADM-${runId}-1` });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.html).toContain(`ADM-${runId}-1`);

    // Admitting twice is refused.
    await expect(decisions.admit(ctx(A.schoolId, A.adminId), a.id, { termId: A.termId, classArmId: A.armId }, reqCtx)).rejects.toBeInstanceOf(ConflictError);

    // The photo is now one of the child's admission documents.
    const docs = await staff.studentDocuments(ctx(A.schoolId, A.adminId), result.studentId);
    expect(docs).toMatchObject({ applicationId: a.id, reference: a.reference });
    expect(docs!.documents.map((d) => d.slot)).toEqual(["PHOTO"]);
    const { url } = await staff.studentDocumentUrl(ctx(A.schoolId, A.adminId), result.studentId, docs!.documents[0]!.id, reqCtx);
    expect(url).toBeTruthy();
  });

  it("admit is offered only once the offer is accepted", async () => {
    const a = await apply(A);
    await decisions.offer(ctx(A.schoolId, A.adminId), a.id, { letter: "L." }, reqCtx);
    await expect(decisions.admit(ctx(A.schoolId, A.adminId), a.id, { termId: A.termId, classArmId: A.armId }, reqCtx)).rejects.toMatchObject({
      code: "ADMISSION_NOT_ACCEPTED",
    });
  });

  it("links a guardian already at the school with the same email (a sibling's parent), never duplicating them", async () => {
    const shared = `Sibling-${runId}@Example.test`;
    const existing = await withTenant(A.schoolId, (db) =>
      db.guardian.create({ data: { schoolId: A.schoolId, firstName: "Amaka", lastName: "Eze", relationship: "MOTHER", phone: "08031234567", email: shared.toLowerCase() } }),
    );
    const a = await toAccepted(A, { guardian: { firstName: "Amaka", lastName: "Eze", relationship: "MOTHER", phone: "08031234567", email: shared } });
    const detail = await staff.get(ctx(A.schoolId, A.adminId), a.id);
    expect(detail.decision.existingGuardian).toMatchObject({ id: existing.id, name: "Amaka Eze" });
    const result = await decisions.admit(ctx(A.schoolId, A.adminId), a.id, { termId: A.termId, classArmId: A.armId, admissionNumber: `ADM-${runId}-2` }, reqCtx);
    expect(result).toMatchObject({ guardianId: existing.id, linkedExistingGuardian: true });
    expect(await withTenant(A.schoolId, (db) => db.guardian.count({ where: { email: { equals: shared, mode: "insensitive" } } }))).toBe(1);
  });

  it("warns of a possible duplicate (same names and date of birth), without blocking", async () => {
    const a = await toAccepted(A, { child: { firstName: "Tobi", lastName: `Twin${runId}`, dateOfBirth: "2017-01-09", gender: "FEMALE" } });
    await withTenant(A.schoolId, (db) =>
      db.student.create({
        data: { schoolId: A.schoolId, admissionNumber: `DUP-${runId}`, firstName: "TOBI", lastName: `twin${runId}`, dateOfBirth: day("2017-01-09"), gender: "FEMALE" },
      }),
    );
    const detail = await staff.get(ctx(A.schoolId, A.adminId), a.id);
    expect(detail.decision.possibleDuplicates).toEqual([expect.objectContaining({ admissionNumber: `DUP-${runId}` })]);
    await expect(decisions.admit(ctx(A.schoolId, A.adminId), a.id, { termId: A.termId, classArmId: A.armId, admissionNumber: `ADM-${runId}-3` }, reqCtx)).resolves.toBeTruthy();
  });

  it("a failure leaves nothing: a taken admission number creates no student and no guardian, and the offer stays accepted", async () => {
    const a = await toAccepted(A);
    const guardians = await withTenant(A.schoolId, (db) => db.guardian.count());
    await expect(decisions.admit(ctx(A.schoolId, A.adminId), a.id, { termId: A.termId, classArmId: A.armId, admissionNumber: `DUP-${runId}` }, reqCtx)).rejects.toMatchObject({
      code: "ADMISSION_NUMBER_TAKEN",
    });
    expect(await status(A, a.id)).toBe("OFFER_ACCEPTED");
    expect(await withTenant(A.schoolId, (db) => db.guardian.count())).toBe(guardians);
  });

  it("honours the school's numbering, including per-class order", async () => {
    await basePrisma.school.update({
      where: { id: A.schoolId },
      data: { admissionNumberMode: "AUTO", admissionNumberFormat: "ADX/{CLASS}/{NNN}", admissionNumberOrder: "CLASS" },
    });
    try {
      const a = await toAccepted(A);
      const result = await decisions.admit(ctx(A.schoolId, A.adminId), a.id, { termId: A.termId, classArmId: A.armId }, reqCtx);
      expect(result.admissionNumber).toMatch(new RegExp(`^ADX/${A.levelCode}/\\d{3}$`, "i"));
    } finally {
      await basePrisma.school.update({ where: { id: A.schoolId }, data: { admissionNumberMode: "MANUAL", admissionNumberFormat: null, admissionNumberOrder: "SCHOOL" } });
    }
  });

  it("cannot admit past the plan's student limit under enforce; nothing is created", async () => {
    const a = await toAccepted(B);
    // A cap of one, already reached.
    await withTenant(B.schoolId, (db) =>
      db.student.create({ data: { schoolId: B.schoolId, admissionNumber: `FULL-${runId}`, firstName: "On", lastName: "Roll", dateOfBirth: day("2015-01-01"), gender: "MALE" } }),
    );
    await basePrisma.school.update({ where: { id: B.schoolId }, data: { studentCapOverride: 1 } });
    const saved = process.env.PLAN_ENFORCEMENT;
    process.env.PLAN_ENFORCEMENT = "enforce";
    try {
      await expect(decisions.admit(ctx(B.schoolId, B.adminId), a.id, { termId: B.termId, classArmId: B.armId, admissionNumber: `CAP-${runId}` }, reqCtx)).rejects.toMatchObject({
        code: "PLAN_STUDENT_LIMIT",
      });
      expect(await status(B, a.id)).toBe("OFFER_ACCEPTED");
      expect(await withTenant(B.schoolId, (db) => db.student.count())).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.PLAN_ENFORCEMENT;
      else process.env.PLAN_ENFORCEMENT = saved;
      await basePrisma.school.update({ where: { id: B.schoolId }, data: { studentCapOverride: null } });
    }
  });

  // ── The 12-month close ───────────────────────────────────────────────────

  it("closes applications left open for 12 months, tells the family, and leaves recent ones", async () => {
    const old = await apply(B);
    const recent = await apply(B);
    await withTenant(B.schoolId, (db) => db.admissionApplication.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) } }));
    email.sent = [];
    expect(await purge.closeStale(new Date())).toBeGreaterThanOrEqual(1);
    expect(await status(B, old.id)).toBe("WITHDRAWN");
    expect(await status(B, recent.id)).toBe("SUBMITTED");
    expect(email.sent.some((m) => m.html.includes("open for 12 months"))).toBe(true);
  });
});
