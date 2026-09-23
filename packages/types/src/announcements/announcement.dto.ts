import { z } from "zod";

// Announcements (docs/modules/announcements.md) — the school talking to
// everyone at once.
//
// Deliberately NOT part of the calendar (phase-8 D20/Q4, refused twice): an
// event is a DATE ("half term starts on the 14th"), an announcement is a
// MESSAGE ("the gate will be locked from 7am tomorrow"). Merging them gives
// either dated messages nobody can find or undated events that break a
// calendar.

export const ANNOUNCEMENT_AUDIENCES = ["EVERYONE", "PARENTS", "STAFF", "CLASS"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const ANNOUNCEMENT_TITLE_MAX = 120;
export const ANNOUNCEMENT_BODY_MAX = 4000;

/**
 * Four audiences, because those are the four a Nigerian school actually
 * uses. A free-form recipient picker invites mistakes at the worst moment.
 *
 * `urgent` (A4) skips quiet hours and wakes phones. It exists because "the
 * gate is closed tomorrow, do not bring children" is exactly what a school
 * needs to send at 21:30 — and without it they would send nothing and ring
 * parents instead. Every urgent send is audited.
 */
export const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1, "Give the announcement a title.").max(ANNOUNCEMENT_TITLE_MAX),
    body: z.string().trim().min(1, "Write the message.").max(ANNOUNCEMENT_BODY_MAX),
    audience: z.enum(ANNOUNCEMENT_AUDIENCES),
    classArmId: z.string().uuid().optional(),
    urgent: z.boolean().optional(),
  })
  .strict()
  .refine((v) => (v.audience === "CLASS") === (v.classArmId !== undefined), {
    message: "Choose a class for a class announcement, and only for one.",
    path: ["classArmId"],
  });
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  classArmId: string | null;
  /** The class's name, so a list reads without a second request. */
  className: string | null;
  urgent: boolean;
  createdAt: string | Date;
  /** Who sent it — staff see this; families do not need it. */
  createdByName: string | null;
  withdrawnAt: string | Date | null;
}

export interface AnnouncementListResponse {
  data: AnnouncementDto[];
}

/** What a family or student sees: the message, and whether they have read it. */
export interface AnnouncementFeedItemDto {
  id: string;
  title: string;
  body: string;
  urgent: boolean;
  createdAt: string | Date;
  readAt: string | Date | null;
}

export interface AnnouncementFeedResponse {
  data: AnnouncementFeedItemDto[];
  /** How many are unread — what the home screen's dot is driven by. */
  unreadCount: number;
}

export const ANNOUNCEMENT_PERMISSIONS = ["announcement.read", "announcement.create"] as const;
