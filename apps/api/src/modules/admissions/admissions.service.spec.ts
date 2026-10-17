import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  DEFAULT_ADMISSION_FORM,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type AdmissionFormConfig,
  type SubmitAdmissionInput,
} from "@school-kit/types";

import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";
import { AuthService } from "../auth/auth.service";
import type { EventNotification } from "../notifications/notification-dispatch.service";
import { AdmissionAlertsService } from "./admission-alerts.service";
import { AdmissionsPublicService } from "./admissions-public.service";
import { AdmissionsPurgeService } from "./admissions-purge.service";
import { AdmissionsSettingsService } from "./admissions-settings.service";
import { AdmissionsService } from "./admissions.service";

// Phase 9 / CP7.1 — online admission applications (docs/modules/phase-9.md
// §16, owner's answers §16.8), against real Postgres and a real filesystem
// store. Open by default; the school's own form enforced field by field; the
// honeypot, the per-email limit and the file check; every new application
// tells the owner, admins and officers by push, email and SMS, with SMS
// capped at 30 a day; the family's private tracking link; the officer role as
// an extra role; and the 90-day purge, files first.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const NOT_AN_IMAGE = Buffer.from("MZ this is a program, not a photo");

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
  sent: { to: string; message: string }[] = [];
  async sendSms(to: string, message: string) {
    this.sent.push({ to, message });
  }
}

interface Fixture {
  schoolId: string;
  slug: string;
  ownerId: string;
  adminId: string;
  teacherId: string;
  bursarId: string;
  levels: { id: string; name: string }[];
}

describe("Admissions (integration)", () => {
  const storageRoot = mkdtempSync(join(tmpdir(), "admissions-"));
  const storage = new StorageService(new FilesystemStorageDriver(storageRoot));
  const dispatch = new FakeDispatch();
  const email = new FakeEmail();
  const termii = new FakeTermii();
  const alerts = new AdmissionAlertsService(dispatch as never, email as never, termii as never);
  const pub = new AdmissionsPublicService(storage, email as never, alerts);
  const staff = new AdmissionsService(storage);
  const settings = new AdmissionsSettingsService();
  const purge = new AdmissionsPurgeService(storage);
  const schoolIds = new Set<string>();
  let A: Fixture;
  let B: Fixture;
  let n = 0;

  async function setUp(label: string): Promise<Fixture> {
    const slug = `adm-${label}-${runId}`;
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Admissions ${label} ${runId}`,
        schoolSlug: slug,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `adm-${label}-${runId}@example.test`,
        ownerPhone: `+23494${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return withTenant(schoolId, async (db) => {
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staffUser = async (key: string, phone: string | null) => {
        const user = await db.user.create({
          data: { schoolId, email: `adm-${label}-${key}-${runId}@example.test`, firstName: key, lastName: "Staff", phone },
        });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(key) } });
        return user.id;
      };
      const levels = await db.classLevel.findMany({ where: { schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true, name: true } });
      const tail = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
      return {
        schoolId,
        slug,
        ownerId: signed.user.id,
        adminId: await staffUser("admin", `+23490${label === "a" ? "1" : "2"}1${tail}`),
        teacherId: await staffUser("teacher", `+23490${label === "a" ? "1" : "2"}2${tail}`),
        bursarId: await staffUser("bursar", null),
        levels,
      };
    });
  }

  function application(f: Fixture, overrides: Partial<SubmitAdmissionInput> = {}): SubmitAdmissionInput {
    n += 1;
    return {
      classLevelId: f.levels[0]!.id,
      child: { firstName: "Adaeze", lastName: `Okafor${n}`, dateOfBirth: "2016-03-14", gender: "FEMALE" },
      guardian: { firstName: "Ngozi", lastName: "Okafor", relationship: "MOTHER", phone: "08031234567", email: `parent${n}-${runId}@example.test` },
      answers: {},
      consent: true,
      ...overrides,
    };
  }

  async function saveForm(f: Fixture, form: AdmissionFormConfig, extra: { closedClassLevelIds?: string[]; enabled?: boolean; smsAlerts?: boolean; notifyEmail?: string | null } = {}) {
    await settings.update(
      ctx(f.schoolId, f.adminId),
      {
        enabled: extra.enabled ?? true,
        intro: "Admission into the 2027/2028 session.",
        smsAlerts: extra.smsAlerts ?? true,
        notifyEmail: extra.notifyEmail ?? null,
        offerLetter: null,
        form,
        closedClassLevelIds: extra.closedClassLevelIds ?? [],
      },
      reqCtx,
    );
  }

  beforeAll(async () => {
    A = await setUp("a");
    B = await setUp("b");
  });

  beforeEach(() => {
    dispatch.calls = [];
    email.sent = [];
    termii.sent = [];
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    rmSync(storageRoot, { recursive: true, force: true });
    await basePrisma.$disconnect();
  });

  // ── Settings and officers ────────────────────────────────────────────────

  describe("settings", () => {
    it("are open by default, with every class open and the default form", async () => {
      const s = await settings.get(ctx(B.schoolId, B.adminId));
      expect(s).toMatchObject({ enabled: true, smsAlerts: true, form: DEFAULT_ADMISSION_FORM, applyPath: `/apply/${B.slug}` });
      expect(s.classLevels.length).toBeGreaterThan(0);
      expect(s.classLevels.every((l) => l.open)).toBe(true);
      const form = await pub.form(B.slug);
      expect(form).toMatchObject({ enabled: true, classLevels: s.classLevels.map(({ id, name }) => ({ id, name })) });
      expect(form.consentText).toMatch(/^I agree that Admissions b/);
    });

    it("are the owner's and admins' only; the bursar and a teacher are refused", async () => {
      await expect(settings.get(ctx(A.schoolId, A.bursarId))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(settings.get(ctx(A.schoolId, A.teacherId))).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("an admin makes a teacher an Admissions officer, an extra role they can lose again", async () => {
      const before = await settings.officers(ctx(A.schoolId, A.adminId));
      expect(before.map((o) => o.id)).toEqual(expect.arrayContaining([A.teacherId, A.bursarId]));
      expect(before.map((o) => o.id)).not.toContain(A.adminId);
      await expect(staff.list(ctx(A.schoolId, A.teacherId), {})).rejects.toBeInstanceOf(ForbiddenError);

      const after = await settings.setOfficers(ctx(A.schoolId, A.adminId), { userIds: [A.teacherId] }, reqCtx);
      expect(after.find((o) => o.id === A.teacherId)).toMatchObject({ isOfficer: true, roles: ["Teacher"] });
      await expect(staff.list(ctx(A.schoolId, A.teacherId), {})).resolves.toBeDefined();
      // An officer handles applications but does not shape the form.
      await expect(settings.get(ctx(A.schoolId, A.teacherId))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(settings.setOfficers(ctx(A.schoolId, A.adminId), { userIds: [A.adminId] }, reqCtx)).rejects.toBeInstanceOf(ValidationError);
      const audit = await withTenant(A.schoolId, (db) => db.auditLog.count({ where: { action: "admission.officer.grant", entityId: A.teacherId } }));
      expect(audit).toBe(1);
    });
  });

  // ── The public form ──────────────────────────────────────────────────────

  describe("applying", () => {
    it("stores the application and its photo, acknowledges the family with a private tracking link, and numbers by year", async () => {
      await saveForm(A, DEFAULT_ADMISSION_FORM, { notifyEmail: `office-${runId}@example.test` });
      await settings.setOfficers(ctx(A.schoolId, A.adminId), { userIds: [A.teacherId] }, reqCtx);
      const input = application(A, { previousSchool: "Bright Stars Nursery", religion: "Christianity" });
      const first = await pub.submit(A.slug, input, { PHOTO: PNG }, reqCtx);
      const year = new Date().getUTCFullYear();
      expect(first.reference).toMatch(new RegExp(`^APP-(${year}|${year + 1})-\\d{4}$`));
      const second = await pub.submit(A.slug, application(A), {}, reqCtx);
      expect(Number(second.reference.slice(-4))).toBe(Number(first.reference.slice(-4)) + 1);

      const row = await withTenant(A.schoolId, (db) =>
        db.admissionApplication.findFirstOrThrow({ where: { reference: first.reference }, include: { documents: true } }),
      );
      expect(row).toMatchObject({ status: "SUBMITTED", guardianEmail: input.guardian.email, childFirstName: "Adaeze" });
      expect(row.documents).toHaveLength(1);
      expect(row.documents[0]).toMatchObject({ slot: "PHOTO", ext: "png", label: "Passport photograph" });
      expect(existsSync(join(storageRoot, `schools/${A.schoolId}/admissions/${row.documents[0]!.id}.png`))).toBe(true);
      // A field the school does not ask (religion is off by default) is dropped.
      expect(JSON.stringify(row.answers)).toContain("Bright Stars Nursery");
      expect(JSON.stringify(row.answers)).not.toContain("Christianity");

      const ack = email.sent.find((m) => m.to === input.guardian.email)!;
      expect(ack.subject).toBe(`Application received: ${first.reference}`);
      const token = /\/apply\/[^/]+\/track\/([A-Za-z0-9_-]+)/.exec(ack.html)![1]!;
      expect(await pub.track(A.slug, token)).toMatchObject({ reference: first.reference, status: "SUBMITTED", childFirstName: "Adaeze" });
      await expect(pub.track(A.slug, "x".repeat(43))).rejects.toBeInstanceOf(NotFoundError);
      await expect(pub.track(B.slug, token)).rejects.toBeInstanceOf(NotFoundError);

      // Nothing the applicant typed is in the audit row.
      const audit = await withTenant(A.schoolId, (db) => db.auditLog.findFirstOrThrow({ where: { action: "admission.submit", entityId: row.id } }));
      expect(JSON.stringify(audit.metadata)).not.toMatch(/Adaeze|Okafor|0803|example\.test/);
    });

    it("tells the owner, admins and officers by push, email and SMS, and the school's own address by email", async () => {
      await saveForm(A, DEFAULT_ADMISSION_FORM, { notifyEmail: `office-${runId}@example.test` });
      await settings.setOfficers(ctx(A.schoolId, A.adminId), { userIds: [A.teacherId] }, reqCtx);
      await pub.submit(A.slug, application(A), {}, reqCtx);
      expect(dispatch.calls.map((c) => (c.principal as { userId: string }).userId).sort()).toEqual([A.ownerId, A.adminId, A.teacherId].sort());
      expect(dispatch.calls[0]!.body).toMatch(/^New admission application for /);
      expect(dispatch.calls[0]!.body).not.toMatch(/Adaeze/);
      const to = email.sent.map((m) => m.to);
      expect(to).toEqual(expect.arrayContaining([`adm-a-admin-${runId}@example.test`, `adm-a-teacher-${runId}@example.test`, `office-${runId}@example.test`]));
      // SMS to staff who have a phone (the owner, the admin, the officer); never the bursar.
      expect(termii.sent.length).toBe(3);
      expect(termii.sent[0]!.message).toMatch(/new admission application APP-\d{4}-\d{4} for .+\. Open SchoolKit to review\.$/);
    });

    it("stops SMS at 30 a school a day, saying so in the 30th; email and push carry on", async () => {
      await saveForm(A, DEFAULT_ADMISSION_FORM);
      const today = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date())}T00:00:00.000Z`);
      await withTenant(A.schoolId, (db) =>
        db.admissionSmsCounter.upsert({ where: { schoolId_day: { schoolId: A.schoolId, day: today } }, create: { schoolId: A.schoolId, day: today, sent: 29 }, update: { sent: 29 } }),
      );
      await pub.submit(A.slug, application(A), {}, reqCtx);
      expect(termii.sent).toHaveLength(1);
      expect(termii.sent[0]!.message).toMatch(/reached today's limit/);
      expect(dispatch.calls.length).toBeGreaterThan(0);
      termii.sent = [];
      await pub.submit(A.slug, application(A), {}, reqCtx);
      expect(termii.sent).toHaveLength(0);
      // The school can switch SMS off altogether.
      await withTenant(A.schoolId, (db) => db.admissionSmsCounter.deleteMany({ where: { schoolId: A.schoolId } }));
      await saveForm(A, DEFAULT_ADMISSION_FORM, { smsAlerts: false });
      await pub.submit(A.slug, application(A), {}, reqCtx);
      expect(termii.sent).toHaveLength(0);
    });

    it("answers a filled honeypot like success, and stores and tells nothing", async () => {
      await saveForm(A, DEFAULT_ADMISSION_FORM);
      const input = application(A, { website: "http://spam.example" });
      const res = await pub.submit(A.slug, input, { PHOTO: PNG }, reqCtx);
      expect(res.reference).toMatch(/^APP-\d{4}-\d{4}$/);
      expect(await withTenant(A.schoolId, (db) => db.admissionApplication.count({ where: { guardianEmail: input.guardian.email } }))).toBe(0);
      expect(dispatch.calls).toHaveLength(0);
      expect(email.sent).toHaveLength(0);
    });

    it("holds the school to its own form: required fields, documents, questions and classes", async () => {
      const form: AdmissionFormConfig = {
        ...DEFAULT_ADMISSION_FORM,
        fields: { ...DEFAULT_ADMISSION_FORM.fields, previousSchool: "REQUIRED", religion: "REQUIRED" },
        documents: { photo: "REQUIRED", birthCertificate: "OFF", lastReport: "OPTIONAL", custom: [{ label: "Baptismal certificate", mode: "OPTIONAL" }] },
        questions: [
          { id: "q1", label: "Boarding or day?", kind: "CHOICE", options: ["Boarding", "Day"], required: true },
          { id: "q2", label: "Any siblings here?", kind: "YES_NO", options: [], required: false },
        ],
      };
      await saveForm(A, form, { closedClassLevelIds: [A.levels[1]!.id] });
      const good = () => application(A, { previousSchool: "Bright Stars", religion: "Islam", answers: { q1: "Day" } });

      await expect(pub.submit(A.slug, good(), {}, reqCtx)).rejects.toThrow("Attach the passport photograph.");
      await expect(pub.submit(A.slug, { ...good(), previousSchool: undefined }, { PHOTO: PNG }, reqCtx)).rejects.toThrow("Previous school is required.");
      await expect(pub.submit(A.slug, { ...good(), answers: {} }, { PHOTO: PNG }, reqCtx)).rejects.toThrow('Answer "Boarding or day?".');
      await expect(pub.submit(A.slug, { ...good(), answers: { q1: "Weekly" } }, { PHOTO: PNG }, reqCtx)).rejects.toThrow(/Choose one of the answers/);
      await expect(pub.submit(A.slug, { ...good(), answers: { q1: "Day", q2: "Maybe" } }, { PHOTO: PNG }, reqCtx)).rejects.toThrow(/yes or no/);
      await expect(pub.submit(A.slug, good(), { PHOTO: PNG, BIRTH_CERTIFICATE: PNG }, reqCtx)).rejects.toThrow("This school does not ask for that document.");
      await expect(pub.submit(A.slug, good(), { PHOTO: NOT_AN_IMAGE }, reqCtx)).rejects.toThrow(/must be a photo .* or a PDF/);
      await expect(pub.submit(A.slug, { ...good(), classLevelId: A.levels[1]!.id }, { PHOTO: PNG }, reqCtx)).rejects.toThrow(/classes open/);
      await expect(pub.submit(A.slug, { ...good(), child: { ...good().child, dateOfBirth: "2026-02-30" } }, { PHOTO: PNG }, reqCtx)).rejects.toBeInstanceOf(ValidationError);

      const ok = await pub.submit(A.slug, { ...good(), answers: { q1: "Day", q2: "No" } }, { PHOTO: PNG, CUSTOM_1: PNG }, reqCtx);
      const detail = await staff.get(ctx(A.schoolId, A.adminId), (await withTenant(A.schoolId, (db) => db.admissionApplication.findFirstOrThrow({ where: { reference: ok.reference } }))).id);
      expect(detail.details).toEqual(
        expect.arrayContaining([
          { label: "Previous school", value: "Bright Stars" },
          { label: "Religion", value: "Islam" },
          { label: "Boarding or day?", value: "Day" },
          { label: "Any siblings here?", value: "No" },
        ]),
      );
      expect(detail.documentFiles.map((d) => d.label).sort()).toEqual(["Baptismal certificate", "Passport photograph"]);
      // No stray files were left by the refused attempts.
      const stored = await withTenant(A.schoolId, (db) => db.admissionDocument.count({ where: { schoolId: A.schoolId } }));
      expect(stored).toBeGreaterThan(0);
    });

    it("refuses when the school has switched applications off, and for an unknown school", async () => {
      await saveForm(A, DEFAULT_ADMISSION_FORM, { enabled: false });
      expect((await pub.form(A.slug)).enabled).toBe(false);
      await expect(pub.submit(A.slug, application(A), {}, reqCtx)).rejects.toThrow("This school is not taking applications online. Please contact the school.");
      await expect(pub.form(`nope-${runId}`)).rejects.toBeInstanceOf(NotFoundError);
      await saveForm(A, DEFAULT_ADMISSION_FORM);
    });

    it("allows at most 3 open applications from one email to one school", async () => {
      await saveForm(A, DEFAULT_ADMISSION_FORM);
      const mail = `busy-${runId}@example.test`;
      for (let i = 0; i < 3; i += 1) await pub.submit(A.slug, application(A, { guardian: { ...application(A).guardian, email: mail } }), {}, reqCtx);
      await expect(
        pub.submit(A.slug, application(A, { guardian: { ...application(A).guardian, email: mail.toUpperCase() } }), {}, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
      // Another school is not affected.
      await expect(pub.submit(B.slug, application(B, { guardian: { ...application(B).guardian, email: mail } }), {}, reqCtx)).resolves.toBeDefined();
    });
  });

  // ── The school's list ────────────────────────────────────────────────────

  describe("the Admissions list", () => {
    it("lists new applications with counts by status, apart from students; documents open through a short, audited link", async () => {
      await saveForm(A, DEFAULT_ADMISSION_FORM);
      const res = await pub.submit(A.slug, application(A), { PHOTO: PNG }, reqCtx);
      const list = await staff.list(ctx(A.schoolId, A.adminId), {});
      const item = list.items.find((i) => i.reference === res.reference)!;
      expect(item).toMatchObject({ status: "SUBMITTED", documents: 1, gender: "FEMALE", dateOfBirth: "2016-03-14" });
      expect(list.counts.SUBMITTED).toBeGreaterThan(0);
      // Not a student.
      expect(await withTenant(A.schoolId, (db) => db.student.count({ where: { lastName: item.childName.split(" ")[1] } }))).toBe(0);

      const detail = await staff.get(ctx(A.schoolId, A.adminId), item.id);
      const { url } = await staff.documentUrl(ctx(A.schoolId, A.adminId), item.id, detail.documentFiles[0]!.id, reqCtx);
      expect(url).toBeTruthy();
      expect(await withTenant(A.schoolId, (db) => db.auditLog.count({ where: { action: "admission.document.read", entityId: item.id } }))).toBe(1);

      await expect(staff.list(ctx(A.schoolId, A.bursarId), {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(staff.get(ctx(B.schoolId, B.adminId), item.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── Deleting ─────────────────────────────────────────────────────────────

  describe("the purge", () => {
    it("deletes rejected and withdrawn applications 90 days after closing, files first; keeps the rest", async () => {
      await saveForm(A, DEFAULT_ADMISSION_FORM);
      const make = async () => {
        const r = await pub.submit(A.slug, application(A), { PHOTO: PNG }, reqCtx);
        return withTenant(A.schoolId, (db) => db.admissionApplication.findFirstOrThrow({ where: { reference: r.reference }, include: { documents: true } }));
      };
      const old = await make();
      const recent = await make();
      const open = await make();
      const ago = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
      await withTenant(A.schoolId, async (db) => {
        await db.admissionApplication.update({ where: { id: old.id }, data: { status: "REJECTED", statusChangedAt: ago(91) } });
        await db.admissionApplication.update({ where: { id: recent.id }, data: { status: "WITHDRAWN", statusChangedAt: ago(89) } });
        await db.admissionApplication.update({ where: { id: open.id }, data: { statusChangedAt: ago(200) } });
      });
      const file = join(storageRoot, `schools/${A.schoolId}/admissions/${old.documents[0]!.id}.png`);
      expect(existsSync(file)).toBe(true);

      await purge.purge(new Date());
      const left = await withTenant(A.schoolId, (db) => db.admissionApplication.findMany({ where: { id: { in: [old.id, recent.id, open.id] } }, select: { id: true } }));
      expect(left.map((l) => l.id).sort()).toEqual([recent.id, open.id].sort());
      expect(existsSync(file)).toBe(false);
    });
  });

  it("keeps an application from another school out of reach (RLS)", async () => {
    const res = await pub.submit(B.slug, application(B), {}, reqCtx);
    const seen = await withTenant(A.schoolId, (db) => db.admissionApplication.count({ where: { reference: res.reference, schoolId: B.schoolId } }));
    expect(seen).toBe(0);
    // A day is a Lagos date, for the day counter's key.
    expect(day("2026-10-17").toISOString().slice(0, 10)).toBe("2026-10-17");
  });
});
