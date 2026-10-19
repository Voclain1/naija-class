import type { PhotoStatusDto, PhotoUrlsDto } from "@school-kit/types";

import { apiFetch } from "@/lib/api-client";

// Passport photos (docs/modules/id-cards-and-store.md §2). Uploads are the
// cropped JPEG the browser made (crop.ts); links are signed and short-lived,
// asked for in batches (use-photo-urls.ts).

const id = (value: string) => encodeURIComponent(value);

function jpegForm(jpeg: Blob): FormData {
  const form = new FormData();
  form.append("file", jpeg, "photo.jpg");
  return form;
}

export const uploadStudentPhoto = (studentId: string, jpeg: Blob) =>
  apiFetch<PhotoStatusDto>(`/students/${id(studentId)}/photo`, { method: "POST", body: jpegForm(jpeg) });
export const removeStudentPhoto = (studentId: string) =>
  apiFetch<PhotoStatusDto>(`/students/${id(studentId)}/photo`, { method: "DELETE" });
export const studentPhotoUrls = (ids: string[]) =>
  apiFetch<PhotoUrlsDto>("/students/photo-urls", { method: "POST", body: { ids } });

export const uploadStaffPhoto = (userId: string, jpeg: Blob) =>
  apiFetch<PhotoStatusDto>(`/users/${id(userId)}/photo`, { method: "POST", body: jpegForm(jpeg) });
export const removeStaffPhoto = (userId: string) =>
  apiFetch<PhotoStatusDto>(`/users/${id(userId)}/photo`, { method: "DELETE" });
export const uploadOwnPhoto = (jpeg: Blob) =>
  apiFetch<PhotoStatusDto>("/users/me/photo", { method: "POST", body: jpegForm(jpeg) });
export const removeOwnPhoto = () => apiFetch<PhotoStatusDto>("/users/me/photo", { method: "DELETE" });
export const staffPhotoUrls = (ids: string[]) =>
  apiFetch<PhotoUrlsDto>("/users/photo-urls", { method: "POST", body: { ids } });
