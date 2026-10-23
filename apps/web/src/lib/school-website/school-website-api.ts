// The school's public website (docs/modules/school-website.md).

import type {
  PlatformWebsiteReportQueueDto,
  PlatformWebsiteReviewDto,
  SchoolWebsiteDto,
  UpdateWebsitePhotoInput,
  UpdateWebsitePostInput,
  WebsiteAlbumDto,
  WebsiteDetailsInput,
  WebsitePhotoDto,
  WebsitePhotoKind,
  WebsitePhotoListDto,
  WebsitePostDto,
  WebsitePostInput,
  WebsitePreviewDto,
  WebsiteTakeDownInput,
} from "@school-kit/types";

import { apiFetch, proxyFetch } from "../api-client";

const id = (value: string) => encodeURIComponent(value);

export const getSchoolWebsite = () => apiFetch<SchoolWebsiteDto>("/school-website", { method: "GET" });
export const saveWebsiteDraft = (details: WebsiteDetailsInput) =>
  apiFetch<SchoolWebsiteDto>("/school-website/draft", { method: "PUT", body: details });
export const publishWebsite = () => apiFetch<SchoolWebsiteDto>("/school-website/publish", { method: "POST" });
export const previewWebsite = () => apiFetch<WebsitePreviewDto>("/school-website/preview", { method: "POST" });

export const listWebsitePhotos = (kind?: WebsitePhotoKind) =>
  apiFetch<WebsitePhotoListDto>(`/school-website/photos${kind ? `?kind=${kind}` : ""}`, { method: "GET" });

export function uploadWebsitePhoto(
  photo: { large: Blob; thumb: Blob },
  fields: { kind: WebsitePhotoKind; postId?: string; albumId?: string; caption?: string },
): Promise<WebsitePhotoDto> {
  const form = new FormData();
  form.append("file", photo.large, "photo.jpg");
  form.append("thumb", photo.thumb, "thumb.jpg");
  form.append("kind", fields.kind);
  if (fields.postId) form.append("postId", fields.postId);
  if (fields.albumId) form.append("albumId", fields.albumId);
  if (fields.caption) form.append("caption", fields.caption);
  // The uploader ticked "This photo shows no pupils" to get here.
  form.append("noPupils", "true");
  return apiFetch<WebsitePhotoDto>("/school-website/photos", { method: "POST", body: form });
}

export const updateWebsitePhoto = (photoId: string, input: UpdateWebsitePhotoInput) =>
  apiFetch<WebsitePhotoDto>(`/school-website/photos/${id(photoId)}`, { method: "PATCH", body: input });
export const deleteWebsitePhoto = (photoId: string) =>
  apiFetch<void>(`/school-website/photos/${id(photoId)}`, { method: "DELETE" });

export const createWebsiteAlbum = (title: string) =>
  apiFetch<WebsiteAlbumDto>("/school-website/albums", { method: "POST", body: { title } });
export const renameWebsiteAlbum = (albumId: string, title: string) =>
  apiFetch<WebsiteAlbumDto>(`/school-website/albums/${id(albumId)}`, { method: "PATCH", body: { title } });
export const deleteWebsiteAlbum = (albumId: string) =>
  apiFetch<void>(`/school-website/albums/${id(albumId)}`, { method: "DELETE" });

export const listWebsitePosts = () => apiFetch<WebsitePostDto[]>("/school-website/posts", { method: "GET" });
export const createWebsitePost = (input: WebsitePostInput) =>
  apiFetch<WebsitePostDto>("/school-website/posts", { method: "POST", body: input });
export const updateWebsitePost = (postId: string, input: UpdateWebsitePostInput) =>
  apiFetch<WebsitePostDto>(`/school-website/posts/${id(postId)}`, { method: "PATCH", body: input });
export const setWebsitePostPublished = (postId: string, publish: boolean) =>
  apiFetch<WebsitePostDto>(`/school-website/posts/${id(postId)}/${publish ? "publish" : "unpublish"}`, { method: "POST" });
export const deleteWebsitePost = (postId: string) =>
  apiFetch<void>(`/school-website/posts/${id(postId)}`, { method: "DELETE" });

// SchoolKit's operator, through the super-admin proxy (its own session).
export const getWebsiteReportQueue = () =>
  proxyFetch<PlatformWebsiteReportQueueDto>("/api/platform-admin/website-reports", { method: "GET" });
export const getPlatformWebsiteReview = (schoolId: string) =>
  proxyFetch<PlatformWebsiteReviewDto>(`/api/platform-admin/schools/${id(schoolId)}/website`, { method: "GET" });
export const takeDownWebsiteItem = (schoolId: string, input: WebsiteTakeDownInput) =>
  proxyFetch<void>(`/api/platform-admin/schools/${id(schoolId)}/website/take-down`, { method: "POST", body: JSON.stringify(input) });
export const dismissWebsiteReport = (schoolId: string, reportId: string) =>
  proxyFetch<void>(`/api/platform-admin/schools/${id(schoolId)}/website/reports/${id(reportId)}/dismiss`, { method: "POST" });
