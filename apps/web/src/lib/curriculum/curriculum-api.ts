// Typed wrappers around the Phase 7 / CP2 curriculum endpoints.
// Mirrors apps/web/src/lib/lesson-plans/lesson-plans-api.ts.
//
// NOTE on timing, and it is the opposite of the lesson-plan client's note:
// these calls are FAST. Upload parses, chunks and checks caps in the request,
// then returns 202 — the slow, rate-limited embedding runs on a queue. So a
// caller gets a quick answer and must then POLL for the document to leave
// PENDING/PROCESSING. `pollUntilSettled` below exists so every caller does that
// the same way rather than each inventing its own interval.

import type {
  CurriculumDocumentDetailResponse,
  CurriculumDocumentDto,
  CurriculumDocumentListResponse,
  CurriculumUploadAcceptedResponse,
  ListCurriculumDocumentsQuery,
  PasteCurriculumDocumentInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listCurriculumDocuments(
  query: ListCurriculumDocumentsQuery = {},
): Promise<CurriculumDocumentListResponse> {
  const params = new URLSearchParams();
  if (query.subjectId) params.set("subjectId", query.subjectId);
  if (query.classLevelId) params.set("classLevelId", query.classLevelId);
  if (query.status) params.set("status", query.status);
  const qs = params.toString();
  return apiFetch<CurriculumDocumentListResponse>(
    `/curriculum/documents${qs ? `?${qs}` : ""}`,
    { method: "GET" },
  );
}

export function getCurriculumDocument(
  documentId: string,
): Promise<CurriculumDocumentDetailResponse> {
  return apiFetch<CurriculumDocumentDetailResponse>(`/curriculum/documents/${documentId}`, {
    method: "GET",
  });
}

export function uploadCurriculumFile(input: {
  file: File;
  subjectId: string;
  classLevelId: string;
  title: string;
}): Promise<CurriculumUploadAcceptedResponse> {
  const form = new FormData();
  form.append("file", input.file);
  form.append("subjectId", input.subjectId);
  form.append("classLevelId", input.classLevelId);
  form.append("title", input.title);
  // apiFetch detects FormData and lets the browser set the multipart boundary.
  return apiFetch<CurriculumUploadAcceptedResponse>("/curriculum/documents/upload", {
    method: "POST",
    body: form,
  });
}

export function pasteCurriculumText(
  input: PasteCurriculumDocumentInput,
): Promise<CurriculumUploadAcceptedResponse> {
  return apiFetch<CurriculumUploadAcceptedResponse>("/curriculum/documents/paste", {
    method: "POST",
    body: input,
  });
}

export function deleteCurriculumDocument(documentId: string): Promise<void> {
  return apiFetch<void>(`/curriculum/documents/${documentId}`, { method: "DELETE" });
}

export const SETTLED_STATUSES = ["READY", "FAILED"] as const;

export function isSettled(status: CurriculumDocumentDto["status"]): boolean {
  return status === "READY" || status === "FAILED";
}

/**
 * Poll a document until it leaves PENDING/PROCESSING, or until `timeoutMs`.
 *
 * Bounded on purpose. An unbounded poll on a document whose worker is wedged
 * would spin against the API for as long as the tab stays open; returning the
 * last known state lets the UI say "still processing" honestly rather than
 * implying it has stalled forever or that it has finished.
 */
export async function pollUntilSettled(
  documentId: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<CurriculumDocumentDto> {
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;

  let last: CurriculumDocumentDto | null = null;
  while (Date.now() < deadline) {
    const { document } = await getCurriculumDocument(documentId);
    last = document;
    if (isSettled(document.status)) return document;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (last) return last;
  const { document } = await getCurriculumDocument(documentId);
  return document;
}
