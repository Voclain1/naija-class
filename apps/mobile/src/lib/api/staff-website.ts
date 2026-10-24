import type {
  SchoolWebsiteDto,
  WebsiteAlbumDto,
  WebsitePhotoDto,
  WebsitePhotoKind,
  WebsitePhotoListDto,
  WebsitePostDto,
  WebsitePostInput,
  WebsitePreviewDto,
} from "@school-kit/types";

import { apiFetch } from "./client";
import { uploadMultipart } from "./native-upload";

// The school's public website, news and photos only
// (docs/modules/school-website.md, staff app). website.manage: owner and admin.
// The page details (cover, about us, leadership) stay on the website.

export const staffWebsite = () => apiFetch<SchoolWebsiteDto>("/school-website");

export const staffWebsitePreview = () => apiFetch<WebsitePreviewDto>("/school-website/preview", { method: "POST" });

// --- news

export const staffWebsitePosts = () => apiFetch<WebsitePostDto[]>("/school-website/posts");

export const staffCreateWebsitePost = (input: WebsitePostInput) =>
  apiFetch<WebsitePostDto>("/school-website/posts", { method: "POST", body: input });

export const staffUpdateWebsitePost = (id: string, input: WebsitePostInput) =>
  apiFetch<WebsitePostDto>(`/school-website/posts/${id}`, { method: "PATCH", body: input });

export const staffSetWebsitePostPublished = (id: string, publish: boolean) =>
  apiFetch<WebsitePostDto>(`/school-website/posts/${id}/${publish ? "publish" : "unpublish"}`, { method: "POST" });

export const staffDeleteWebsitePost = (id: string) => apiFetch<void>(`/school-website/posts/${id}`, { method: "DELETE" });

// --- photos and albums

export const staffWebsitePhotos = (kind: WebsitePhotoKind) =>
  apiFetch<WebsitePhotoListDto>(`/school-website/photos?kind=${kind}`);

export const staffUpdateWebsitePhoto = (id: string, input: { caption?: string | null; albumId?: string | null }) =>
  apiFetch<WebsitePhotoDto>(`/school-website/photos/${id}`, { method: "PATCH", body: input });

export const staffDeleteWebsitePhoto = (id: string) => apiFetch<void>(`/school-website/photos/${id}`, { method: "DELETE" });

export const staffCreateWebsiteAlbum = (title: string) =>
  apiFetch<WebsiteAlbumDto>("/school-website/albums", { method: "POST", body: { title } });

export const staffRenameWebsiteAlbum = (id: string, title: string) =>
  apiFetch<WebsiteAlbumDto>(`/school-website/albums/${id}`, { method: "PATCH", body: { title } });

export const staffDeleteWebsiteAlbum = (id: string) => apiFetch<void>(`/school-website/albums/${id}`, { method: "DELETE" });

export interface WebsitePhotoUpload {
  /** The 1600 px JPEG on disk. */
  largeUri: string;
  /** The 480 px JPEG, as base64: the native uploader sends one file a request. */
  thumbBase64: string;
  kind: "POST" | "GALLERY";
  postId?: string;
  albumId?: string;
  caption?: string;
}

/** Uploads one website photo. The no-pupils tick is the caller's to have asked for. */
export function staffUploadWebsitePhoto(upload: WebsitePhotoUpload): Promise<WebsitePhotoDto> {
  const parameters: Record<string, string> = { kind: upload.kind, noPupils: "true", thumbBase64: upload.thumbBase64 };
  if (upload.postId) parameters.postId = upload.postId;
  if (upload.albumId) parameters.albumId = upload.albumId;
  if (upload.caption?.trim()) parameters.caption = upload.caption.trim();
  return uploadMultipart<WebsitePhotoDto>("/school-website/photos", {
    fileUri: upload.largeUri,
    fieldName: "file",
    mimeType: "image/jpeg",
    parameters,
  });
}
