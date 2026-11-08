import { z } from "zod";
import type { ReportProfile, ReportCardDesign } from "./report-profile.js";

import type { PromotionStatusDto, ReportCardSubjectRowDto } from "./report-card.dto.js";

// POST /report-cards/arm/render — enqueue a per-card PDF render job. By default
// renders EVERY card in (term, arm); the optional `reportCardId` narrows the
// enqueue to a SINGLE card (the per-card "Regenerate" action, slice 5 cp3). The
// reportCardId is still validated against (termId, classArmId) server-side, so a
// card id from another arm matches nothing. Decoupled from slice-6 release.
export const renderArmSchema = z
  .object({
    termId: z.string().trim().min(1),
    classArmId: z.string().trim().min(1),
    reportCardId: z.string().trim().min(1).optional(),
  })
  .strict();
export type RenderArmInput = z.infer<typeof renderArmSchema>;

export interface RenderArmResultDto {
  enqueuedCount: number;
}

// GET /report-cards/:id/pdf — a short-lived signed URL to the rendered PDF.
export interface ReportCardPdfUrlDto {
  signedUrl: string;
  expiresAt: string | Date;
}

// Everything the HTML template needs to render one card. Assembled by
// ReportCardService.getRenderData from the FROZEN ReportCard rollup + the
// per-subject breakdown + school/term/student metadata. EVERY user-controlled
// field is escaped via esc() in the template.
export interface ReportCardRenderData {
  profile?: ReportProfile;
  issuedOn?: string | Date | null;
  classSize?: number;
  nextTermDate?: string | Date | null;
  gradeKey?: { letter: string; minScore: number; maxScore: number; remark: string | null }[];
  school: {
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    design?: ReportCardDesign;
    motto: string | null;
    logoUrl: string | null;
    // School.positionOnReportCardPdf (Phase 8 / CP6a, D51). When false the PDF
    // drops the "Position in Class" box AND the per-subject position column —
    // removed, not printed as a dash, so the card does not look incomplete.
    positionOnReportCardPdf: boolean;
    // Paid design customisation entitlement. Every plan retains school identity,
    // logo, standard fields, positions and cumulative results (2026-11-06).
    branded: boolean;
    /** School.primaryColor, unvalidated; the template only uses a #rrggbb value. */
    primaryColor: string | null;
    /** The logo as a data URI, filled in by RenderService outside the transaction. Null: none. */
    logoDataUri: string | null;
  };
  academicYear: { label: string };
  term: { name: string; startDate: string | Date; endDate: string | Date };
  classArm: { name: string };
  student: {
    firstName: string;
    middleName: string | null;
    lastName: string;
    admissionNumber: string;
    gender: string;
    dateOfBirth: string | Date;
    photoUrl: string | null;
    photoDataUri?: string | null;
  };
  rollup: {
    overallTotal: number | null;
    overallAverage: number | null; // Int hundredths (7350 = 73.50%)
    overallPosition: number | null;
    subjectsCount: number | null;
    formTeacherComment: string | null;
    principalNote: string | null;
    // CP6a (§20.2) — null when the arm was never marked: no line, never "0".
    attendance: { daysOpened: number; present: number; absent: number } | null;
    // CP6a (§20.3) — final term only.
    promotionStatus: PromotionStatusDto | null;
    // CP5a (§22.1) — the year so far, final term only.
    cumulative: { average: number; terms: number; position: number | null } | null;
  };
  subjects: ReportCardSubjectRowDto[];
}
