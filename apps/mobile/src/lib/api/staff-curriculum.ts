import type {
  CurriculumDocumentDto,
  CurriculumUploadAcceptedResponse,
  PasteCurriculumDocumentInput,
  TeacherProfileDto,
  UpdateMyTeacherProfileInput,
} from "@school-kit/types";

import { apiFetch } from "./client";

// CP7 (5) and (6) — the scheme of work a lesson note is grounded in, and the
// teacher's own profile.
//
// D26: the PASTE box is the primary path on a phone, and the file picker is
// second. The server parses PDF and DOCX; it does NOT read photographs, and
// there is no OCR anywhere on this path. A teacher who photographs a syllabus
// and waits for a parse failure would reasonably conclude the feature is
// broken, so the screen says so BEFORE they try.

export function staffListCurriculum(): Promise<CurriculumDocumentDto[]> {
  return apiFetch<CurriculumDocumentDto[]>("/curriculum/documents");
}

export function staffGetCurriculumDocument(documentId: string): Promise<CurriculumDocumentDto> {
  return apiFetch<CurriculumDocumentDto>(
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
  // React Native's FormData takes { uri, name, type } for a file part and the
  // runtime streams it — the file is never read into JS memory, which matters
  // for a 10 MB cap on a low-end handset.
  //
  // Content-Type is deliberately NOT set: fetch must add its own multipart
  // boundary, and setting the header by hand omits it, which makes the server
  // fail to find the 'file' field at all.
  const form = new FormData();
  form.append("subjectId", fields.subjectId);
  form.append("classLevelId", fields.classLevelId);
  form.append("title", fields.title);
  form.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);

  return apiFetch<CurriculumUploadAcceptedResponse>("/curriculum/documents/upload", {
    method: "POST",
    body: form,
  });
}

export function staffApproveCurriculum(documentId: string): Promise<CurriculumDocumentDto> {
  // The review gate: a document stays out of lesson-note grounding until a
  // human confirms the extracted structure.
  return apiFetch<CurriculumDocumentDto>(
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
