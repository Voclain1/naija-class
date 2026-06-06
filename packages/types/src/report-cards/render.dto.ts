import { z } from "zod";

import type { ReportCardSubjectRowDto } from "./report-card.dto.js";

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
  school: { name: string; motto: string | null; logoUrl: string | null };
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
  };
  rollup: {
    overallTotal: number | null;
    overallAverage: number | null; // Int hundredths (7350 = 73.50%)
    overallPosition: number | null;
    subjectsCount: number | null;
    formTeacherComment: string | null;
    principalNote: string | null;
  };
  subjects: ReportCardSubjectRowDto[];
}
