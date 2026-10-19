import { z } from "zod";

// Passport photos for students and staff (2026-10-19,
// docs/modules/id-cards-and-store.md §2). The browser or the staff app crops
// the picture to passport shape and encodes it as JPEG before sending, so the
// API takes JPEG only, up to 5 MB, and keeps one private object per person.
// A photo is shown through a short-lived signed link, never a stored address.

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Passport shape, 35 × 45 mm: width over height. */
export const PHOTO_ASPECT = 35 / 45;

/** The pixel size the clients encode at (enough for a 300 dpi card). */
export const PHOTO_WIDTH_PX = 420;
export const PHOTO_HEIGHT_PX = 540;

/** POST /students/photo-urls, POST /users/photo-urls. */
export const photoUrlsSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict();
export type PhotoUrlsInput = z.infer<typeof photoUrlsSchema>;

/** Signed links by person id; a person with no photo is left out. */
export interface PhotoUrlsDto {
  urls: Record<string, string>;
}

/** The answer to an upload or a removal. */
export interface PhotoStatusDto {
  hasPhoto: boolean;
  photoUploadedAt: string | Date | null;
}
