// Typed wrapper around /announcements (docs/modules/announcements.md).
// Shapes come from @school-kit/types so the client cannot drift from the API.

import type {
  AnnouncementBouncedDto,
  AnnouncementEmailPreviewDto,
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
/** On or off the school's public website (docs/modules/school-website.md). */
export function setAnnouncementOnWebsite(id: string, show: boolean): Promise<AnnouncementDto> {
  return apiFetch<AnnouncementDto>(`/announcements/${encodeURIComponent(id)}/website`, { method: "POST", body: { show } });
}

export function getStaffAnnouncementFeed(): Promise<AnnouncementFeedResponse> {
  return apiFetch<AnnouncementFeedResponse>("/announcements/feed");
}

// Phase 9 / CP8.3 — "Also email families".
export function getAnnouncementEmailPreview(audience: "EVERYONE" | "PARENTS" | "CLASS", classArmId?: string): Promise<AnnouncementEmailPreviewDto> {
  const qs = new URLSearchParams({ audience, ...(classArmId ? { classArmId } : {}) });
  return apiFetch<AnnouncementEmailPreviewDto>(`/announcements/email-preview?${qs}`);
}

export function getAnnouncementBounced(id: string): Promise<AnnouncementBouncedDto[]> {
  return apiFetch<AnnouncementBouncedDto[]>(`/announcements/${encodeURIComponent(id)}/bounced`);
}

/** Marks one announcement read for the signed-in staff member. */
export function markStaffAnnouncementRead(id: string): Promise<void> {
  return apiFetch<void>(`/announcements/${encodeURIComponent(id)}/read`, { method: "POST" });
}
