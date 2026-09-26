// Typed wrapper around /announcements (docs/modules/announcements.md).
// Shapes come from @school-kit/types so the client cannot drift from the API.

import type {
  AnnouncementDto,
  AnnouncementFeedResponse,
  AnnouncementListResponse,
  CreateAnnouncementInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listAnnouncements(): Promise<AnnouncementListResponse> {
  return apiFetch<AnnouncementListResponse>("/announcements");
}

export function createAnnouncement(input: CreateAnnouncementInput): Promise<AnnouncementDto> {
  return apiFetch<AnnouncementDto>("/announcements", { method: "POST", body: input });
}

export function withdrawAnnouncement(id: string): Promise<AnnouncementDto> {
  return apiFetch<AnnouncementDto>(`/announcements/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}

/** What the signed-in staff member should read themselves. */
export function getStaffAnnouncementFeed(): Promise<AnnouncementFeedResponse> {
  return apiFetch<AnnouncementFeedResponse>("/announcements/feed");
}
