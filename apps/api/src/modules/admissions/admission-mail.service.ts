import { Injectable, Logger } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import { ADMISSION_ASSESSMENT_LABEL, formatSickbayDay, formatSickbayTime, type AdmissionAssessmentKind } from "@school-kit/types";

import { EmailService } from "../../common/email/email.service.js";
import { isSuppressedForAll } from "../announcements/announcement-email.shared.js";
import { rebuildTrackingToken } from "./admission-tracking.js";
import { escapeHtml } from "./admissions.shared.js";
import { schoolSiteUrls } from "../../common/school-site-url.js";

// Phase 9 / CP7.2 — the family's status emails (docs/modules/phase-9.md §16
// CP7-D4, §16.8). One email per step: the assessment booked (or changed), an
// offer with its letter IN FULL, not successful, admitted with the admission
// number, and withdrawn. Each names the child by first name and the school,
// gives the reference, and carries the private tracking link.
//
// Sent after the change is saved, and never failing it: an email that cannot
// go is logged by kind only (no address, no name), and the change stands.

export type AdmissionMail =
  | { kind: "ASSESSMENT"; changed: boolean }
  | { kind: "OFFERED" }
  | { kind: "REJECTED" }
  | { kind: "ADMITTED"; admissionNumber: string }
  | { kind: "WITHDRAWN"; by: "FAMILY" | "SCHOOL" | "STALE" };

@Injectable()
export class AdmissionMailService {
  private readonly logger = new Logger(AdmissionMailService.name);

  constructor(private readonly email: EmailService) {}

  async send(schoolId: string, applicationId: string, mail: AdmissionMail): Promise<void> {
    if (!this.email.isConfigured) return;
    try {
      const found = await withTenant(schoolId, async (db) => ({
        school: await db.school.findUnique({ where: { id: schoolId }, select: { name: true, slug: true } }),
        app: await db.admissionApplication.findFirst({
          where: { id: applicationId, schoolId },
          select: {
            reference: true,
            childFirstName: true,
            guardianEmail: true,
            trackingTokenHash: true,
            assessmentKind: true,
            assessmentAt: true,
            assessmentNote: true,
            offerLetter: true,
            decisionNote: true,
            classLevel: { select: { name: true } },
          },
        }),
      }));
      const { school, app } = found;
      if (!school || !app) return;
      // An address that bounced or complained gets no more mail from the school.
      if (await withTenant(schoolId, (db) => isSuppressedForAll(db, schoolId, app.guardianEmail))) return;
      const token = rebuildTrackingToken(applicationId, app.trackingTokenHash);
      const link = token ? schoolSiteUrls(school.slug).track(token) : null;
      const child = escapeHtml(app.childFirstName);
      const schoolName = escapeHtml(school.name);
      const level = escapeHtml(app.classLevel.name);
      const paragraphs = (text: string) => escapeHtml(text).replace(/\r?\n/g, "<br>");

      let subject: string;
      let body: string;
      switch (mail.kind) {
        case "ASSESSMENT": {
          const label = ADMISSION_ASSESSMENT_LABEL[(app.assessmentKind ?? "OTHER") as AdmissionAssessmentKind];
          const when = app.assessmentAt ? `${formatSickbayDay(app.assessmentAt)} at ${formatSickbayTime(app.assessmentAt)}` : "";
          subject = `${mail.changed ? "Changed: " : ""}${label} for ${app.childFirstName}: ${app.reference}`;
          body =
            `<p>${schoolName} has ${mail.changed ? "changed" : "booked"} the ${escapeHtml(label.toLowerCase())} for ${child}'s application into ${level}.</p>` +
            `<p><strong>${escapeHtml(when)}</strong></p>` +
            (app.assessmentNote ? `<p>${paragraphs(app.assessmentNote)}</p>` : "");
          break;
        }
        case "OFFERED":
          subject = `Offer of admission for ${app.childFirstName}: ${app.reference}`;
          body =
            `<p>${schoolName} is pleased to offer ${child} a place in ${level}. The offer letter follows in full.</p>` +
            `<div style="padding:12px 16px;background:#f7f5ef;border-radius:6px">${paragraphs(app.offerLetter ?? "")}</div>` +
            `<p>To accept, use the button on the tracking page below, or tell the school.</p>`;
          break;
        case "REJECTED":
          subject = `Your application for ${app.childFirstName}: ${app.reference}`;
          body =
            `<p>${schoolName} is unable to offer ${child} a place in ${level} this time.</p>` +
            (app.decisionNote ? `<p>${paragraphs(app.decisionNote)}</p>` : "") +
            `<p>The application and its documents will be deleted in 90 days.</p>`;
          break;
        case "ADMITTED":
          subject = `${app.childFirstName} is admitted: ${app.reference}`;
          body =
            `<p>${child} has been admitted to ${schoolName}.</p>` +
            `<p>Admission number: <strong>${escapeHtml(mail.admissionNumber)}</strong>. The school will tell you about the parent portal.</p>`;
          break;
        case "WITHDRAWN":
          subject = `Application withdrawn: ${app.reference}`;
          body =
            (mail.by === "FAMILY"
              ? `<p>You have withdrawn the application for ${child} to ${schoolName}.</p>`
              : mail.by === "STALE"
                ? `<p>The application for ${child} to ${schoolName} has been open for 12 months without a decision, so it has been closed.</p>`
                : `<p>${schoolName} has withdrawn the application for ${child}, as asked.</p>`) +
            `<p>The application and its documents will be deleted in 90 days. Contact the school if this is a mistake.</p>`;
          break;
      }
      const tracking =
        link && mail.kind !== "ADMITTED"
          ? `<p>See the application at any time: <a href="${link}">${link}</a></p><p>Keep this link private.</p>`
          : !link && mail.kind !== "ADMITTED"
            ? `<p>You can see the application with the private link in your first email from the school.</p>`
            : "";
      await this.email.send({
        to: app.guardianEmail,
        purpose: `admission-${mail.kind.toLowerCase()}`,
        schoolName: school.name,
        subject,
        html: body + `<p>Reference: <strong>${app.reference}</strong></p>` + tracking,
      });
    } catch (err) {
      this.logger.warn(`Admission ${mail.kind} email failed: ${String(err)}`);
    }
  }
}
