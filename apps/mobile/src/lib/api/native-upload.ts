import * as FileSystem from "expo-file-system/legacy";

import { ApiNetworkError, apiUrl, bearerHeader, interpretResponse } from "./client";
import { recordServerDate } from "../staff/server-date";

// Multipart file upload through Expo's NATIVE uploader, not fetch + FormData.
//
// Why this exists: the first device build could not upload a curriculum file
// at all. Every attempt reported "Your phone couldn't reach the server" while
// every other screen on the same phone worked, and the live API was confirmed
// up and answering on every curriculum route (a 401 to an unauthenticated
// probe). The failure was therefore on the handset, inside React Native's
// fetch + FormData path — which is known to be unreliable for real files on
// Android — and the app was mislabelling it as a signal problem.
//
// `FileSystem.uploadAsync` streams the file from disk in native code
// (OkHttp on Android, URLSession on iOS). It never passes the file through
// JavaScript, which also matters for a 10 MB cap on a low-end handset.
//
// Kept OUT of client.ts on purpose: that file stays free of native imports so
// it is testable under Vitest's node environment. This module imports native
// code and so is tested by mocking `expo-file-system/legacy` wholesale.

export interface MultipartUpload {
  /** A file:// URI the native layer can read, e.g. from the document picker. */
  fileUri: string;
  /** The form field the server reads the file from. */
  fieldName: string;
  mimeType: string;
  /** Plain form fields sent alongside the file. */
  parameters: Record<string, string>;
}

export async function uploadMultipart<T>(path: string, upload: MultipartUpload): Promise<T> {
  let result: FileSystem.FileSystemUploadResult;
  try {
    result = await FileSystem.uploadAsync(apiUrl(path), upload.fileUri, {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: upload.fieldName,
      mimeType: upload.mimeType,
      parameters: upload.parameters,
      headers: { Accept: "application/json", ...bearerHeader() },
    });
  } catch (cause) {
    // The native layer threw: the file could not be read, or the request
    // could not be made. The cause is KEPT — the previous path discarded it,
    // which is why a failure on a real phone could only be guessed at.
    throw new ApiNetworkError(cause);
  }

  // Header names are case-insensitive on the wire but not in this object.
  recordServerDate(result.headers.date ?? result.headers.Date ?? null);

  if (result.status === 204) return undefined as T;
  return interpretResponse<T>(result.status, "", result.body);
}

/**
 * A short, human-readable reason for a failed upload, from the native error.
 *
 * Shown on screen beneath the plain-English message so that a teacher who
 * reports "it still fails" can read out WHY, instead of the next fix being a
 * guess the way this one had to start as.
 */
export function uploadFailureDetail(error: unknown): string | null {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause) return cause;
  return null;
}
