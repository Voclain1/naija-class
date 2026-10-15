import { ValidationError } from "@school-kit/types";

import type { PrivateFileExt } from "./storage.types.js";

// F1 — private file uploads (docs/modules/phase-9.md §4, built in CP3.2).
//
// One rule for every private upload (health documents now; submissions,
// admission documents and library resources later): images or PDF, at most
// 10 MB, and the TYPE is read from the file's own first bytes. The name and
// the browser's declared Content-Type are the uploader's claim; the bytes are
// the file. A renamed .exe stays refused, and an image is always served back
// with the Content-Type it really has.
//
// The object is stored privately and read only through a short-lived signed
// URL, issued after the caller's access to the owning record is checked.

export const PRIVATE_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const PRIVATE_FILE_URL_TTL_SECONDS = 5 * 60;

const MIME: Record<PrivateFileExt, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** The file's real type from its first bytes, or null if it is none of ours. */
export function sniffPrivateFile(buffer: Buffer): { ext: PrivateFileExt; mime: string } | null {
  const b = buffer;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: MIME.jpg };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", mime: MIME.png };
  }
  if (b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") {
    return { ext: "webp", mime: MIME.webp };
  }
  if (b.length >= 5 && b.subarray(0, 5).toString("ascii") === "%PDF-") return { ext: "pdf", mime: MIME.pdf };
  return null;
}

/** Throws a ValidationError unless the upload is an allowed type and size. */
export function assertPrivateFile(buffer: Buffer): { ext: PrivateFileExt; mime: string } {
  if (buffer.length === 0) throw new ValidationError("INVALID_UPLOAD", "The file is empty.");
  if (buffer.length > PRIVATE_FILE_MAX_BYTES) {
    throw new ValidationError("FILE_TOO_LARGE", "The file is larger than 10 MB.");
  }
  const kind = sniffPrivateFile(buffer);
  if (!kind) {
    throw new ValidationError("INVALID_FILE_TYPE", "Upload a photo (JPEG, PNG or WebP) or a PDF.");
  }
  return kind;
}

export function mimeForPrivateFile(ext: PrivateFileExt): string {
  return MIME[ext];
}
