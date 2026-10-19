import type { MyIdCardDto, PhotoStatusDto, PhotoUrlsDto } from "@school-kit/types";

import { apiFetch } from "./client";
import { uploadMultipart } from "./native-upload";

// The staff member's own passport photo (docs/modules/id-cards-and-store.md
// §2). The picker crops and re-encodes it as a JPEG before it is sent.

export const staffOwnPhotoUrl = (userId: string) =>
  apiFetch<PhotoUrlsDto>("/users/photo-urls", { method: "POST", body: { ids: [userId] } });

export const staffUploadOwnPhoto = (fileUri: string) =>
  uploadMultipart<PhotoStatusDto>("/users/me/photo", { fileUri, fieldName: "file", mimeType: "image/jpeg", parameters: {} });

/** The staff member's own ID card, if the school has issued one. */
export const staffMyIdCard = () => apiFetch<MyIdCardDto>("/id-cards/me", { method: "GET" });
