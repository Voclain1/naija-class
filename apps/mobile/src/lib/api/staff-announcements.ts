import type {
  AnnouncementDto,
  AnnouncementFeedResponse,
  AnnouncementListResponse,
  CreateAnnouncementInput,
} from "@school-kit/types";

import { apiFetch } from "./client";

// Announcements on the staff side (docs/modules/announcements.md).
//
// Two reads, deliberately separate: `staffAnnouncementsSent` is the school's
// outbox — what has gone out, who it went to, and the withdraw lever — and is
// owner/admin only. `staffAnnouncementFeed` is what THIS staff member should
// read themselves, which every staff role has. A head is both, and the two
// answer different questions on the same screen.

export function staffAnnouncementsSent(): Promise<AnnouncementListResponse> {
  return apiFetch<AnnouncementListResponse>("/announcements");
}

export function staffAnnouncementFeed(): Promise<AnnouncementFeedResponse> {
  return apiFetch<AnnouncementFeedResponse>("/announcements/feed");
}

export function createStaffAnnouncement(input: CreateAnnouncementInput): Promise<AnnouncementDto> {
  return apiFetch<AnnouncementDto>("/announcements", { method: "POST", body: input });
}

export function withdrawStaffAnnouncement(id: string): Promise<AnnouncementDto> {
  return apiFetch<AnnouncementDto>(`/announcements/${encodeURIComponent(id)}/withdraw`, { method: "POST" });
}

export function markStaffAnnouncementRead(id: string): Promise<void> {
  return apiFetch<void>(`/announcements/${encodeURIComponent(id)}/read`, { method: "POST" });
}
