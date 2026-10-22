import { randomInt, randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";

import { basePrisma, Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ADMISSION_ASSESSMENT_LABEL,
  ADMISSION_CONSENT_VERSION,
  ADMISSION_DOCUMENT_LABEL,
  ADMISSION_FIELD_LABEL,
  ADMISSION_LIMITS,
  ADMISSION_OPEN_STATUSES,
  ADMISSION_STANDARD_DOCUMENTS,
  ADMISSION_STANDARD_SLOT,
  ADMISSION_STATUS_FAMILY_LABEL,
  admissionConsentText,
  ConflictError,
  formatSickbayDay,
  formatSickbayTime,
  NotFoundError,
  sickbayDayOf,
  ValidationError,
  type AdmissionAssessmentKind,
  type AdmissionDocumentSlot,
  type AdmissionFormConfig,
  type AdmissionTrackDto,
  type PublicAdmissionFormDto,
  type SubmitAdmissionInput,
  type SubmitAdmissionResultDto,
} from "@school-kit/types";

import { EmailService } from "../../common/email/email.service.js";
import { assertPrivateFile } from "../../common/storage/private-file.js";
import { LOGO_URL_TTL_SECONDS, parseLogoExt } from "../../common/storage/school-logo.js";
import { StorageService } from "../../common/storage/storage.service.js";
import type { PrivateFileExt } from "../../common/storage/storage.types.js";
import { AdmissionAlertsService } from "./admission-alerts.service.js";
import { AdmissionMailService } from "./admission-mail.service.js";
import { admissionTrackingToken } from "./admission-tracking.js";
import { escapeHtml, hashToken, loadAdmissionSettings, openClassLevels } from "./admissions.shared.js";
import { resolveSchoolCode } from "../../common/slug/school-code.js";
import { schoolSiteUrls } from "../../common/school-site-url.js";

// Phase 9 / CP7.1 — the PUBLIC side of admissions (docs/modules/phase-9.md
// §16, §16.8). No login: anyone may read a school's form and send one
// application, in ONE multipart request, so a stranger never leaves staged
// files behind.
//
// The school resolves by slug through `schools` (no RLS), then every read and
// write runs under that school's GUC, as the result checker does. Protections:
// per-address limits on the controller; a honeypot (`website`) answered like
// success with nothing stored; at most 3 open applications per email per
// school; files typed by their bytes (F1); the school's form enforced field by
// field. Nothing the applicant typed reaches an audit row or a log line.

type Db = PrismaClient;
interface RequestContext {
  ipAddress: string | null;
}

/** The six upload slots, as the multipart field names the form sends. */
export const ADMISSION_UPLOAD_FIELDS: Record<AdmissionDocumentSlot, string> = {
  PHOTO: "photo",
  BIRTH_CERTIFICATE: "birthCertificate",
  LAST_REPORT: "lastReport",
  CUSTOM_1: "custom1",
  CUSTOM_2: "custom2",
  CUSTOM_3: "custom3",
};


@Injectable()
export class AdmissionsPublicService {
  private readonly logger = new Logger(AdmissionsPublicService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly email: EmailService,
    private readonly alerts: AdmissionAlertsService,
    private readonly mail: AdmissionMailService,
  ) {}

  /** What the public page needs to draw the school's form. */
  async form(slug: string): Promise<PublicAdmissionFormDto> {
    const school = await resolveSchool(slug);
    return withTenant(school.id, async (db) => {
      const settings = await loadAdmissionSettings(db, school.id);
      const ext = parseLogoExt(school.logoUrl);
      const logoUrl = ext ? await this.storage.signUrl(school.id, { kind: "school-logo", ext }, LOGO_URL_TTL_SECONDS).catch(() => null) : null;
      return {
        schoolName: school.name,
        logoUrl,
        enabled: settings.enabled,
        intro: settings.intro,
        classLevels: await openClassLevels(db, school.id, settings.closedClassLevelIds),
        form: settings.form,
        consentText: admissionConsentText(school.name),
      };
    });
  }

  /** One application: checked against the school's form, stored, acknowledged, and the school told. */
  async submit(
    slug: string,
    input: SubmitAdmissionInput,
    files: Partial<Record<AdmissionDocumentSlot, Buffer>>,
    req: RequestContext,
  ): Promise<SubmitAdmissionResultDto> {
    const school = await resolveSchool(slug);
    const year = Number(sickbayDayOf(new Date()).slice(0, 4));

    // A bot filled the field a person never sees: answer like success, keep nothing.
    if (input.website && input.website.trim() !== "") {
      return { reference: `APP-${year}-${String(randomInt(1000, 9999))}` };
    }

    const prepared = await withTenant(school.id, async (db) => {
      const settings = await loadAdmissionSettings(db, school.id);
      if (!settings.enabled) throw new ConflictError("ADMISSIONS_CLOSED", "This school is not taking applications online. Please contact the school.");
      const open = await openClassLevels(db, school.id, settings.closedClassLevelIds);
      const level = open.find((l) => l.id === input.classLevelId);
      if (!level) throw new ValidationError("Choose one of the classes open for application.");
      const email = input.guardian.email.toLowerCase();
      const already = await db.admissionApplication.count({ where: { schoolId: school.id, guardianEmail: email, status: { in: [...ADMISSION_OPEN_STATUSES] } } });
      if (already >= ADMISSION_LIMITS.openPerEmail) {
        throw new ConflictError(
          "TOO_MANY_OPEN_APPLICATIONS",
          `There are already ${ADMISSION_LIMITS.openPerEmail} open applications from this email address. Please wait for the school to reply.`,
        );
      }
      return { settings, level, email };
    });

    const answers = checkAnswers(input, prepared.settings.form);
    const documents = checkDocuments(files, prepared.settings.form);
    const dateOfBirth = checkDateOfBirth(input.child.dateOfBirth);

    // Files first, under fresh ids; removed again if the row cannot be written.
    const stored: { id: string; slot: AdmissionDocumentSlot; label: string; ext: PrivateFileExt; size: number }[] = [];
    try {
      for (const d of documents) {
        const id = randomUUID();
        await this.storage.put(school.id, { kind: "admission-document", documentId: id, ext: d.ext }, d.buffer, d.mime);
        stored.push({ id, slot: d.slot, label: d.label, ext: d.ext, size: d.buffer.length });
      }
    } catch (err) {
      await this.removeFiles(school.id, stored);
      throw err;
    }

    // The id is chosen here so the tracking link can be derived from it (CP7.2).
    const applicationId = randomUUID();
    const token = admissionTrackingToken(applicationId);
    let created: { id: string; reference: string };
    try {
      created = await withTenant(school.id, async (db) => {
        const reference = await nextReference(db, school.id, year);
        const app = await db.admissionApplication.create({
          data: {
            id: applicationId,
            schoolId: school.id,
            reference,
            classLevelId: prepared.level.id,
            childFirstName: input.child.firstName,
            childLastName: input.child.lastName,
            dateOfBirth,
            gender: input.child.gender,
            guardianFirstName: input.guardian.firstName,
            guardianLastName: input.guardian.lastName,
            guardianRelationship: input.guardian.relationship,
            guardianPhone: input.guardian.phone,
            guardianEmail: prepared.email,
            answers: answers as Prisma.InputJsonValue,
            consentAt: new Date(),
            consentVersion: ADMISSION_CONSENT_VERSION,
            trackingTokenHash: hashToken(token),
          },
          select: { id: true, reference: true },
        });
        if (stored.length) {
          await db.admissionDocument.createMany({
            data: stored.map((s) => ({ id: s.id, schoolId: school.id, applicationId: app.id, slot: s.slot, label: s.label, ext: s.ext, sizeBytes: s.size })),
          });
        }
        // Who applied is not recorded: the audit row says only that one arrived.
        await db.auditLog.create({
          data: {
            schoolId: school.id,
            userId: null,
            action: "admission.submit",
            entityType: "admission_application",
            entityId: app.id,
            ipAddress: req.ipAddress,
            metadata: { classLevelId: prepared.level.id, documents: stored.length },
          },
        });
        return app;
      });
    } catch (err) {
      await this.removeFiles(school.id, stored);
      throw err;
    }

    await this.acknowledge(school.name, school.slug, prepared.email, input.child.firstName, prepared.level.name, created.reference, token);
    await this.alerts.newApplication(school.id, created.id);
    return { reference: created.reference };
  }

  /** The family's private tracking link (§16.8 answer 3). */
  async track(slug: string, token: string): Promise<AdmissionTrackDto> {
    const school = await resolveSchool(slug);
    return withTenant(school.id, async (db) => {
      const app = await findByToken(db, school.id, token);
      const open = (ADMISSION_OPEN_STATUSES as readonly string[]).includes(app.status);
      return {
        schoolName: school.name,
        reference: app.reference,
        childFirstName: app.childFirstName,
        classLevel: app.classLevel.name,
        status: app.status,
        statusLabel: ADMISSION_STATUS_FAMILY_LABEL[app.status],
        submittedAt: app.createdAt,
        decision: {
          // Shown while it can still matter: not once the application is closed.
          assessment:
            app.assessmentKind && app.assessmentAt && open
              ? {
                  label: ADMISSION_ASSESSMENT_LABEL[app.assessmentKind as AdmissionAssessmentKind],
                  day: formatSickbayDay(app.assessmentAt),
                  time: formatSickbayTime(app.assessmentAt),
                  note: app.assessmentNote,
                }
              : null,
          offerLetter: app.status === "OFFERED" || app.status === "OFFER_ACCEPTED" || app.status === "ADMITTED" ? app.offerLetter : null,
          acceptedAt: app.acceptedAt,
          decisionNote: app.status === "REJECTED" ? app.decisionNote : null,
          canAccept: app.status === "OFFERED",
          canWithdraw: open,
        },
      };
    });
  }

  /**
   * The family accepts on the tracking page, which shows the letter in full
   * above the button (§16.8 answer 2). No member of staff recorded it, so
   * `accepted_by_user_id` stays NULL: that is the record it was the family.
   */
  async acceptOffer(slug: string, token: string, req: RequestContext): Promise<AdmissionTrackDto> {
    const school = await resolveSchool(slug);
    await withTenant(school.id, async (db) => {
      const app = await findByToken(db, school.id, token);
      const now = new Date();
      const done = await db.admissionApplication.updateMany({
        where: { id: app.id, schoolId: school.id, status: "OFFERED" },
        data: { status: "OFFER_ACCEPTED", statusChangedAt: now, acceptedAt: now, acceptedByUserId: null },
      });
      if (done.count !== 1) throw new ConflictError("ADMISSION_CHANGED", "This offer can no longer be accepted here. Please contact the school.");
      await db.auditLog.create({
        data: {
          schoolId: school.id,
          userId: null,
          action: "admission.accept",
          entityType: "admission_application",
          entityId: app.id,
          ipAddress: req.ipAddress,
          metadata: { from: "OFFERED", to: "OFFER_ACCEPTED", via: "FAMILY" },
        },
      });
    });
    return this.track(slug, token);
  }

  /** The family withdraws the application themselves. */
  async withdraw(slug: string, token: string, req: RequestContext): Promise<AdmissionTrackDto> {
    const school = await resolveSchool(slug);
    const id = await withTenant(school.id, async (db) => {
      const app = await findByToken(db, school.id, token);
      const done = await db.admissionApplication.updateMany({
        where: { id: app.id, schoolId: school.id, status: { in: [...ADMISSION_OPEN_STATUSES] } },
        data: { status: "WITHDRAWN", statusChangedAt: new Date() },
      });
      if (done.count !== 1) throw new ConflictError("ADMISSION_CHANGED", "This application can no longer be withdrawn here. Please contact the school.");
      await db.auditLog.create({
        data: {
          schoolId: school.id,
          userId: null,
          action: "admission.withdraw",
          entityType: "admission_application",
          entityId: app.id,
          ipAddress: req.ipAddress,
          metadata: { from: app.status, to: "WITHDRAWN", by: "FAMILY" },
        },
      });
      return app.id;
    });
    await this.mail.send(school.id, id, { kind: "WITHDRAWN", by: "FAMILY" });
    return this.track(slug, token);
  }

  private async acknowledge(schoolName: string, slug: string, to: string, childFirstName: string, levelName: string, reference: string, token: string) {
    if (!this.email.isConfigured) return;
    const link = schoolSiteUrls(slug).track(token);
    try {
      await this.email.send({
        to,
        purpose: "admission-received",
        schoolName,
        subject: `Application received: ${reference}`,
        html:
          `<p>${escapeHtml(schoolName)} has received the application for ${escapeHtml(childFirstName)} into ${escapeHtml(levelName)}.</p>` +
          `<p>Your reference is <strong>${reference}</strong>. The school will reply by email.</p>` +
          `<p>You can see where the application stands at any time: <a href="${link}">${link}</a></p>` +
          `<p>Keep this link private; anyone with it can see the application's progress.</p>`,
      });
    } catch (err) {
      this.logger.warn(`Admission acknowledgement email failed: ${String(err)}`);
    }
  }

  private async removeFiles(schoolId: string, stored: { id: string; ext: PrivateFileExt }[]) {
    for (const s of stored) {
      await this.storage.delete(schoolId, { kind: "admission-document", documentId: s.id, ext: s.ext }).catch(() => undefined);
    }
  }
}

/** One application by its tracking token, at this school only. */
async function findByToken(db: Db, schoolId: string, token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw new NotFoundError("This tracking link is not valid.");
  const app = await db.admissionApplication.findUnique({
    where: { trackingTokenHash: hashToken(token) },
    select: {
      id: true,
      schoolId: true,
      reference: true,
      childFirstName: true,
      status: true,
      createdAt: true,
      assessmentKind: true,
      assessmentAt: true,
      assessmentNote: true,
      offerLetter: true,
      acceptedAt: true,
      decisionNote: true,
      classLevel: { select: { name: true } },
    },
  });
  if (!app || app.schoolId !== schoolId) throw new NotFoundError("This tracking link is not valid.");
  return app;
}

async function resolveSchool(slug: string) {
  // An earlier address still finds the school (school-code.ts): admission
  // links shared before a change keep working.
  const found = await resolveSchoolCode(slug);
  if (!found) throw new NotFoundError("There is no school at this address.");
  const school = await basePrisma.school.findUnique({ where: { id: found.schoolId }, select: { id: true, slug: true, name: true, logoUrl: true, suspendedAt: true } });
  if (!school || school.suspendedAt) throw new NotFoundError("There is no school at this address.");
  return school;
}

/** APP-<year>-<n>: one atomic upsert, so two applications never share a number. */
async function nextReference(db: Db, schoolId: string, year: number): Promise<string> {
  const rows = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
    INSERT INTO admission_reference_counters (school_id, year, next) VALUES (${schoolId}, ${year}, 2)
    ON CONFLICT (school_id, year) DO UPDATE SET next = admission_reference_counters.next + 1
    RETURNING next - 1 AS n`);
  return `APP-${year}-${String(rows[0]!.n).padStart(4, "0")}`;
}

function checkDateOfBirth(day: string): Date {
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) throw new ValidationError("Enter a real date of birth.");
  const years = (Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years < 1 || years > 25) throw new ValidationError("Check the date of birth.");
  return d;
}

/**
 * The school's optional fields and own questions, checked against its form:
 * a required one must be answered; one not asked is dropped. Labels are copied
 * in with the answers, so a later edit of the form never changes an answer.
 */
export function checkAnswers(input: SubmitAdmissionInput, form: AdmissionFormConfig): Record<string, unknown> {
  const fields: { key: string; label: string; value: string }[] = [];
  const simple = ["middleName", "previousSchool", "previousClass", "homeAddress", "religion", "stateOfOrigin", "medicalNeeds"] as const;
  for (const key of simple) {
    const modeFor = form.fields[key];
    const value = key === "middleName" ? input.child.middleName : input[key];
    if (modeFor === "OFF") continue;
    if (modeFor === "REQUIRED" && !value) throw new ValidationError(`${ADMISSION_FIELD_LABEL[key]} is required.`);
    if (value) fields.push({ key, label: ADMISSION_FIELD_LABEL[key], value });
  }
  let secondGuardian: SubmitAdmissionInput["secondGuardian"] | undefined;
  if (form.fields.secondGuardian !== "OFF") {
    if (form.fields.secondGuardian === "REQUIRED" && !input.secondGuardian) throw new ValidationError("A second parent or guardian is required.");
    secondGuardian = input.secondGuardian;
  }
  const questions: { id: string; label: string; answer: string }[] = [];
  for (const q of form.questions) {
    const answer = (input.answers[q.id] ?? "").trim();
    if (!answer) {
      if (q.required) throw new ValidationError(`Answer "${q.label}".`);
      continue;
    }
    if (q.kind === "SHORT" && answer.length > ADMISSION_LIMITS.shortAnswer) throw new ValidationError(`"${q.label}" is too long.`);
    if (q.kind === "YES_NO" && answer !== "Yes" && answer !== "No") throw new ValidationError(`Answer "${q.label}" with yes or no.`);
    if (q.kind === "CHOICE" && !q.options.includes(answer)) throw new ValidationError(`Choose one of the answers to "${q.label}".`);
    questions.push({ id: q.id, label: q.label, answer });
  }
  return { fields, ...(secondGuardian ? { secondGuardian } : {}), questions };
}

/** The files, against the documents the school asks for: required ones present, ones not asked refused. */
export function checkDocuments(
  files: Partial<Record<AdmissionDocumentSlot, Buffer>>,
  form: AdmissionFormConfig,
): { slot: AdmissionDocumentSlot; label: string; buffer: Buffer; ext: PrivateFileExt; mime: string }[] {
  const asked: { slot: AdmissionDocumentSlot; label: string; mode: "REQUIRED" | "OPTIONAL" | "OFF" }[] = [
    ...ADMISSION_STANDARD_DOCUMENTS.map((d) => ({ slot: ADMISSION_STANDARD_SLOT[d], label: ADMISSION_DOCUMENT_LABEL[d], mode: form.documents[d] })),
    ...(["CUSTOM_1", "CUSTOM_2", "CUSTOM_3"] as const).map((slot, i) => {
      const c = form.documents.custom[i];
      return { slot, label: c?.label ?? "", mode: c ? c.mode : ("OFF" as const) };
    }),
  ];
  const out: { slot: AdmissionDocumentSlot; label: string; buffer: Buffer; ext: PrivateFileExt; mime: string }[] = [];
  for (const a of asked) {
    const buffer = files[a.slot];
    if (!buffer) {
      if (a.mode === "REQUIRED") throw new ValidationError(`Attach the ${a.label.toLowerCase()}.`);
      continue;
    }
    if (a.mode === "OFF") throw new ValidationError("This school does not ask for that document.");
    let typed: { ext: PrivateFileExt; mime: string };
    try {
      typed = assertPrivateFile(buffer);
    } catch {
      throw new ValidationError(`The ${a.label.toLowerCase()} must be a photo (JPG, PNG or WebP) or a PDF, up to 10 MB.`);
    }
    out.push({ slot: a.slot, label: a.label, buffer, ...typed });
  }
  return out;
}
