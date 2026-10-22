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
    /** Phase 9 / CP8.3: also email the families (not for STAFF). */
    emailFamilies: z.boolean().optional(),
    /** 2026-10-22: also on the school's public website (Everyone or Parents only). */
    showOnWebsite: z.boolean().optional(),
  })
  .strict()
  .refine((v) => (v.audience === "CLASS") === (v.classArmId !== undefined), {
    message: "Choose a class for a class announcement, and only for one.",
    path: ["classArmId"],
  })
  .refine((v) => !(v.emailFamilies && v.audience === "STAFF"), {
    message: "Staff announcements are not emailed.",
    path: ["emailFamilies"],
  })
  .refine((v) => !v.showOnWebsite || ANNOUNCEMENT_WEBSITE_AUDIENCES.includes(v.audience), {
    message: "Only announcements to everyone or to parents can go on the website.",
    path: ["showOnWebsite"],
  });

/** The audiences whose announcements may be shown on the public website. */
export const ANNOUNCEMENT_WEBSITE_AUDIENCES: readonly AnnouncementAudience[] = ["EVERYONE", "PARENTS"];
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
  /** CP8.3: how the email to families went; null when it was not emailed. */
  email: AnnouncementEmailSummaryDto | null;
  /** On the school's public website. */
  showOnWebsite: boolean;
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

// ─── Phase 9 / CP8.3: email broadcasts (docs/modules/phase-9.md §17.11) ────

export const ANNOUNCEMENT_EMAIL_STATUSES = ["QUEUED", "SENDING", "SENT", "DELIVERED", "BOUNCED", "COMPLAINED", "FAILED", "SKIPPED"] as const;
export type AnnouncementEmailStatus = (typeof ANNOUNCEMENT_EMAIL_STATUSES)[number];
export const ANNOUNCEMENT_EMAIL_SKIP_REASONS = ["UNSUBSCRIBED", "SUPPRESSED", "CAPPED", "EMAIL_OFF"] as const;
export type AnnouncementEmailSkipReason = (typeof ANNOUNCEMENT_EMAIL_SKIP_REASONS)[number];

/** Counts only: nobody sees who opened what. */
export interface AnnouncementEmailSummaryDto {
  /** Addresses still waiting to go. */
  waiting: number;
  /** Accepted by the mail service (includes delivered). */
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
  unsubscribed: number;
  /** Bounced or complained before, so not tried. */
  suppressed: number;
  /** Past the plan's daily limit. */
  capped: number;
  /** The school's email channel was off. */
  emailOff: number;
  /** Families in the audience with no email address. */
  noAddress: number;
}

// GET /announcements/email-preview?audience=&classArmId=
export const announcementEmailPreviewSchema = z.object({
  audience: z.enum(["EVERYONE", "PARENTS", "CLASS"]),
  classArmId: z.string().uuid().optional(),
});
export type AnnouncementEmailPreviewInput = z.infer<typeof announcementEmailPreviewSchema>;

export interface AnnouncementEmailPreviewDto {
  /** Distinct addresses that would be emailed (before the daily limit). */
  addresses: number;
  /** Families in the audience with no address. */
  noAddress: number;
  /** Left of today's plan allowance. */
  remainingToday: number;
  dailyLimit: number;
  /** The school's email channel is on. */
  emailEnabled: boolean;
}

// GET /announcements/:id/bounced — addresses to fix.
export interface AnnouncementBouncedDto {
  guardianId: string | null;
  guardianName: string | null;
  email: string;
  children: string[];
  status: "BOUNCED" | "COMPLAINED";
}

// Unsubscribe (public, from the link in each email).
export const emailUnsubscribeQuerySchema = z.object({
  s: z.string().min(1).max(100),
  e: z.string().email().max(320),
  t: z.string().regex(/^[0-9a-f]{64}$/),
});
export type EmailUnsubscribeQuery = z.infer<typeof emailUnsubscribeQuerySchema>;

export const emailUnsubscribeSchema = emailUnsubscribeQuerySchema.extend({ subscribe: z.boolean().default(false) });
export type EmailUnsubscribeInput = z.infer<typeof emailUnsubscribeSchema>;

export interface EmailUnsubscribeStatusDto {
  schoolName: string;
  /** Announcement emails from this school are on for this address. */
  subscribed: boolean;
}

// GET / POST /portal/email-preferences
export const portalEmailPreferencesSchema = z.object({ announcements: z.boolean() }).strict();
export type PortalEmailPreferencesInput = z.infer<typeof portalEmailPreferencesSchema>;

export interface PortalEmailPreferencesDto {
  /** The guardian's address, or null when the school holds none. */
  email: string | null;
  announcements: boolean;
  /** The address bounced or complained: the school must fix it first. */
  blocked: boolean;
}

/** The outbox's sentences for an emailed announcement, shared by web and app. */
export function announcementEmailLines(s: AnnouncementEmailSummaryDto): string[] {
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const lines: string[] = [];
  if (s.waiting > 0) lines.push(`${n(s.waiting, "email")} still going out`);
  lines.push(`${n(s.sent, "email")} sent${s.delivered > 0 ? `, ${s.delivered} delivered` : ""}`);
  if (s.bounced + s.complained > 0) lines.push(`${n(s.bounced + s.complained, "address", "addresses")} bounced or marked as spam`);
  if (s.failed > 0) lines.push(`${n(s.failed, "email")} could not be sent`);
  if (s.unsubscribed > 0) lines.push(`${n(s.unsubscribed, "parent")} unsubscribed`);
  if (s.suppressed > 0) lines.push(`${n(s.suppressed, "address", "addresses")} skipped after an earlier bounce`);
  if (s.capped > 0) lines.push(`${n(s.capped, "email")} not sent: your plan's daily limit`);
  if (s.emailOff > 0) lines.push(`${n(s.emailOff, "email")} not sent: email is switched off in Settings → Notifications`);
  if (s.noAddress > 0) lines.push(`${n(s.noAddress, "parent")} with no email address`);
  return lines;
}
