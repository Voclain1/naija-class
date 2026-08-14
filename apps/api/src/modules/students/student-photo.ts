import type { StorageService } from "../../common/storage";

// Student.photoUrl holds TWO shapes, deliberately (2026-08-14):
//
//   1. A STORAGE PATH — "schools/<schoolId>/students/<studentId>/photo.png" —
//      written by the real photo upload on the student edit surface.
//   2. An EXTERNAL URL — "https://…" — the pre-existing behaviour, still used
//      by CSV bulk import and by manual student creation, both of which
//      deliberately keep the paste-a-link pattern (the storage key needs a
//      studentId, which does not exist until the student is created).
//
// Everything that DISPLAYS a photo needs a URL a browser can load, so shape 1
// must be signed and shape 2 must be passed through untouched. This module is
// the single place that distinction is made; adding a fourth consumer means
// calling this, not re-implementing the check.
//
// CROSS-STUDENT SAFETY. There is deliberately NO cache here — not a module
// map, not a memo, nothing keyed by anything. Every call signs from the
// student's OWN row: the studentId comes from the row being resolved and goes
// straight into the storage key, so two students in one request (or one
// session, or one roster) can never resolve to the same object or the same
// signed URL. A cache is the obvious "optimisation" here and it is exactly how
// one child's photograph would end up displayed under another child's name;
// if one is ever added it must be keyed by (schoolId, studentId, ext) and
// nothing less.

// 15 minutes, matching expense receipts rather than the school logo's 1 hour.
// A logo is public branding displayed for a whole session; this is a
// photograph of a child, and a signed URL is a bearer credential for it — the
// shorter the window in which a leaked URL is useful, the better.
export const STUDENT_PHOTO_URL_TTL_SECONDS = 900;

const STUDENT_PHOTO_PATH_RE =
  /^schools\/[0-9a-f-]{36}\/students\/([0-9a-f-]{36})\/photo\.(png|jpg|webp)$/i;

export type StudentPhotoExt = "png" | "jpg" | "webp";

// Parses a stored value as a student-photo storage path, or returns null if it
// is anything else (an external URL, an empty string, a legacy value).
export function parseStudentPhotoPath(
  value: string | null,
): { studentId: string; ext: StudentPhotoExt } | null {
  if (!value) return null;
  const m = STUDENT_PHOTO_PATH_RE.exec(value);
  if (!m) return null;
  return { studentId: m[1]!, ext: m[2]!.toLowerCase() as StudentPhotoExt };
}

// Resolves ONE stored value to something a browser can load.
export async function resolveStudentPhotoUrl(
  storage: StorageService,
  schoolId: string,
  photoUrl: string | null,
): Promise<string | null> {
  const parsed = parseStudentPhotoPath(photoUrl);
  if (!parsed) return photoUrl; // external URL or null — pass straight through
  return storage.signUrl(
    schoolId,
    { kind: "student-photo", studentId: parsed.studentId, ext: parsed.ext },
    STUDENT_PHOTO_URL_TTL_SECONDS,
  );
}

// Batch form for list surfaces (roster, class list, portal children). Signs
// only the rows that actually carry a storage path, so a school that has never
// uploaded a photo pays nothing. Each row is resolved independently from its
// own value — see the cross-student note above.
export async function resolveStudentPhotoUrls<T extends { photoUrl: string | null }>(
  storage: StorageService,
  schoolId: string,
  rows: T[],
): Promise<T[]> {
  return Promise.all(
    rows.map(async (row) => {
      const parsed = parseStudentPhotoPath(row.photoUrl);
      if (!parsed) return row;
      return {
        ...row,
        photoUrl: await storage.signUrl(
          schoolId,
          { kind: "student-photo", studentId: parsed.studentId, ext: parsed.ext },
          STUDENT_PHOTO_URL_TTL_SECONDS,
        ),
      };
    }),
  );
}
