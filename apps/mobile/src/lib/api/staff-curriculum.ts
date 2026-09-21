import type {
  ApproveCurriculumDocumentResponse,
  CurriculumDocumentDetailResponse,
  CurriculumDocumentListResponse,
  CurriculumUploadAcceptedResponse,
  PasteCurriculumDocumentInput,
  TeacherProfileDto,
  UpdateMyTeacherProfileInput,
} from "@school-kit/types";

import { apiFetch } from "./client";
import { uploadMultipart } from "./native-upload";

// CP7 (5) and (6) — the scheme of work a lesson note is grounded in, and the
// teacher's own profile.
//
// D26: the PASTE box is the primary path on a phone, and the file picker is
// second. The server parses PDF and DOCX; it does NOT read photographs, and
// there is no OCR anywhere on this path. A teacher who photographs a syllabus
// and waits for a parse failure would reasonably conclude the feature is
// broken, so the screen says so BEFORE they try.

// NOT an array. The endpoint returns `{ documents, usage }` — the usage block
// is cap telemetry so a teacher can be warned before they hit a refusal.
//
// Getting this wrong is what crashed the screen on the first device build:
// `apiFetch<T>` is an unchecked assertion about the wire, the screen called
// `.map` on the envelope object, and nothing upstream could have caught it —
// typecheck believed the annotation, and the earlier spec asserted the URL but
// never the shape. The specs now decode realistic payloads for that reason.
export function staffListCurriculum(): Promise<CurriculumDocumentListResponse> {
  return apiFetch<CurriculumDocumentListResponse>("/curriculum/documents");
}

/** `{ document, chunks }` — the chunks ARE the review payload. */
export function staffGetCurriculumDocument(
  documentId: string,
): Promise<CurriculumDocumentDetailResponse> {
  return apiFetch<CurriculumDocumentDetailResponse>(
    `/curriculum/documents/${encodeURIComponent(documentId)}`,
  );
}

export function staffPasteCurriculum(
  input: PasteCurriculumDocumentInput,
): Promise<CurriculumUploadAcceptedResponse> {
  // 202: the text is accepted and parsed in the background, so this returns a
  // receipt rather than a finished document. The list is what reports progress.
  return apiFetch<CurriculumUploadAcceptedResponse>("/curriculum/documents/paste", {
    method: "POST",
    body: input,
  });
}

export interface CurriculumFileUpload {
  uri: string;
  name: string;
  mimeType: string;
}

export function staffUploadCurriculumFile(
  fields: { subjectId: string; classLevelId: string; title: string },
  file: CurriculumFileUpload,
): Promise<CurriculumUploadAcceptedResponse> {
  // Through the NATIVE uploader, not fetch + FormData — see native-upload.ts
  // for why: the FormData path failed on every attempt on a real Android
  // phone while the server was up and every other request worked.
  //
  // The field name "file" and the three form fields are exactly what the
  // controller reads (FileInterceptor("file") + uploadCurriculumDocumentSchema).
  return uploadMultipart<CurriculumUploadAcceptedResponse>("/curriculum/documents/upload", {
    fileUri: file.uri,
    fieldName: "file",
    mimeType: file.mimeType,
    parameters: {
      subjectId: fields.subjectId,
      classLevelId: fields.classLevelId,
      title: fields.title,
    },
  });
}

export function staffApproveCurriculum(
  documentId: string,
): Promise<ApproveCurriculumDocumentResponse> {
  // The review gate: a document stays out of lesson-note grounding until a
  // human confirms the extracted structure. Returns `{ document, chunkCount }`.
  return apiFetch<ApproveCurriculumDocumentResponse>(
    `/curriculum/documents/${encodeURIComponent(documentId)}/approve`,
    { method: "POST" },
  );
}

export function staffDeleteCurriculum(documentId: string): Promise<void> {
  return apiFetch<void>(`/curriculum/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
}

// --- profile (CP7 item 6) --------------------------------------------------

export function staffMyProfile(): Promise<TeacherProfileDto> {
  return apiFetch<TeacherProfileDto>("/teacher-profiles/me");
}

export function staffUpdateMyProfile(
  input: UpdateMyTeacherProfileInput,
): Promise<TeacherProfileDto> {
  // Self-service is deliberately NARROW: specialty and qualifications only.
  // Staff number, NUT number and joining date are the school's records about
  // the teacher, not the teacher's own, and stay admin-only.
  return apiFetch<TeacherProfileDto>("/teacher-profiles/me", {
    method: "PATCH",
    body: input,
  });
}
