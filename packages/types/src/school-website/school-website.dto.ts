import { z } from "zod";

import type { PlanEnforcement, SchoolPlan } from "../plans/index.js";

// The school's public website (2026-10-22, docs/modules/school-website.md).
// What each plan adds to the basic front page, the editor's shapes, and what
// the public page reads. Every section follows PLAN_ENFORCEMENT: under warn,
// every school has the top tier (W3).

// ─── Plan levels ────────────────────────────────────────────────────────────

export interface WebsiteLimits {
  /** Upcoming events shown. Null: all upcoming (up to WEBSITE_EVENTS_MAX). */
  events: number | null;
  /** Latest announcements shown. */
  announcements: number;
  /** Cover, about us and quick facts. */
  details: boolean;
  /** News posts shown. 0: no news. Null: all. */
  news: number | null;
  /** Photos on one news post. */
  photosPerPost: number;
  /** Photos in the gallery. 0: no gallery. */
  galleryPhotos: number;
  /** People in the leadership section. 0: none. */
  leaders: number;
  admissionsBox: boolean;
  accent: boolean;
  /** "Powered by SchoolKit" in place of the copyright line. */
  poweredBy: boolean;
}

export const WEBSITE_EVENTS_MAX = 30;

export const WEBSITE_PLAN_LIMITS: Record<SchoolPlan, WebsiteLimits> = {
  FREE: { events: 3, announcements: 3, details: false, news: 0, photosPerPost: 0, galleryPhotos: 0, leaders: 0, admissionsBox: false, accent: false, poweredBy: false },
  STARTER: { events: 10, announcements: 10, details: true, news: 10, photosPerPost: 2, galleryPhotos: 0, leaders: 0, admissionsBox: false, accent: false, poweredBy: false },
  GROWTH: { events: null, announcements: 20, details: true, news: null, photosPerPost: 4, galleryPhotos: 60, leaders: 6, admissionsBox: true, accent: false, poweredBy: false },
  PROFESSIONAL: { events: null, announcements: 20, details: true, news: null, photosPerPost: 4, galleryPhotos: 300, leaders: 12, admissionsBox: true, accent: true, poweredBy: true },
  ENTERPRISE: { events: null, announcements: 20, details: true, news: null, photosPerPost: 4, galleryPhotos: 300, leaders: 12, admissionsBox: true, accent: true, poweredBy: true },
};

/** What the school has now: the top tier under warn, its plan's under enforce. */
export function websiteLimitsFor(plan: SchoolPlan, enforcement: PlanEnforcement): WebsiteLimits {
  return enforcement === "warn" ? WEBSITE_PLAN_LIMITS.PROFESSIONAL : WEBSITE_PLAN_LIMITS[plan];
}

export const WEBSITE_SECTIONS = ["events", "announcements", "details", "news", "gallery", "leaders", "admissionsBox", "accent"] as const;
export type WebsiteSection = (typeof WEBSITE_SECTIONS)[number];

export function websiteSectionOpen(limits: WebsiteLimits, section: WebsiteSection): boolean {
  switch (section) {
    case "events":
    case "announcements":
      return true;
    case "details":
      return limits.details;
    case "news":
      return limits.news !== 0;
    case "gallery":
      return limits.galleryPhotos > 0;
    case "leaders":
      return limits.leaders > 0;
    case "admissionsBox":
      return limits.admissionsBox;
    case "accent":
      return limits.accent;
  }
}

/** The cheapest plan that opens a section. */
export function websiteSectionMinPlan(section: WebsiteSection): SchoolPlan {
  const plans: SchoolPlan[] = ["FREE", "STARTER", "GROWTH", "PROFESSIONAL"];
  return plans.find((p) => websiteSectionOpen(WEBSITE_PLAN_LIMITS[p], section)) ?? "ENTERPRISE";
}

// ─── Page details (the draft the editor saves, the version families see) ────

export const WEBSITE_LIMITS = {
  welcome: 120,
  headWelcome: 1200,
  headName: 80,
  headTitle: 60,
  story: 2000,
  curriculum: 60,
  leaderName: 80,
  leaderRole: 60,
  feesText: 120,
  visitNote: 300,
  postTitle: 120,
  postBody: 3000,
  caption: 140,
  albumTitle: 80,
  reportReason: 500,
  takeDownReason: 300,
  /** Hard ceilings whatever the plan. */
  photosPerPost: 4,
  galleryPhotos: 300,
  leaders: 12,
  albums: 30,
  /** Bytes, after the browser resizes. */
  photoBytes: 3 * 1024 * 1024,
  thumbBytes: 512 * 1024,
  /** Pixels on the long side. */
  largeSide: 1600,
  thumbSide: 480,
} as const;

export const WEBSITE_LEVELS = ["CRECHE", "NURSERY", "PRIMARY", "JSS", "SSS"] as const;
export type WebsiteLevel = (typeof WEBSITE_LEVELS)[number];
export const WEBSITE_LEVEL_LABELS: Record<WebsiteLevel, string> = {
  CRECHE: "Crèche",
  NURSERY: "Nursery",
  PRIMARY: "Primary",
  JSS: "Junior secondary",
  SSS: "Senior secondary",
};

export const WEBSITE_BOARDING = ["DAY", "BOARDING", "DAY_AND_BOARDING"] as const;
export type WebsiteBoarding = (typeof WEBSITE_BOARDING)[number];
export const WEBSITE_BOARDING_LABELS: Record<WebsiteBoarding, string> = {
  DAY: "Day school",
  BOARDING: "Boarding school",
  DAY_AND_BOARDING: "Day and boarding",
};

export const WEBSITE_GENDERS = ["MIXED", "BOYS", "GIRLS"] as const;
export type WebsiteGender = (typeof WEBSITE_GENDERS)[number];
export const WEBSITE_GENDER_LABELS: Record<WebsiteGender, string> = { MIXED: "Boys and girls", BOYS: "Boys only", GIRLS: "Girls only" };

/** Each checked for readable white text and for headings on light and dark. */
export const WEBSITE_ACCENTS = {
  emerald: { label: "Emerald", hex: "#0E5C43" },
  navy: { label: "Navy", hex: "#1E3A8A" },
  royal: { label: "Royal blue", hex: "#1D4ED8" },
  maroon: { label: "Maroon", hex: "#7F1D1D" },
  purple: { label: "Purple", hex: "#5B21B6" },
  teal: { label: "Teal", hex: "#0F766E" },
  brown: { label: "Brown", hex: "#78350F" },
  slate: { label: "Slate", hex: "#334155" },
} as const;
export type WebsiteAccent = keyof typeof WEBSITE_ACCENTS;
export const WEBSITE_ACCENT_KEYS = Object.keys(WEBSITE_ACCENTS) as [WebsiteAccent, ...WebsiteAccent[]];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .default(null);

const thisYear = new Date().getUTCFullYear();

export const websiteLeaderSchema = z
  .object({
    name: z.string().trim().min(1, "Give each person a name.").max(WEBSITE_LIMITS.leaderName),
    role: z.string().trim().min(1, "Give each person a role.").max(WEBSITE_LIMITS.leaderRole),
    photoId: z.string().uuid().nullable().default(null),
  })
  .strict();
export type WebsiteLeader = z.infer<typeof websiteLeaderSchema>;

export const websiteDetailsSchema = z
  .object({
    coverPhotoId: z.string().uuid().nullable().default(null),
    welcome: optionalText(WEBSITE_LIMITS.welcome),
    headWelcome: optionalText(WEBSITE_LIMITS.headWelcome),
    headName: optionalText(WEBSITE_LIMITS.headName),
    headTitle: optionalText(WEBSITE_LIMITS.headTitle),
    story: optionalText(WEBSITE_LIMITS.story),
    founded: z.number().int().min(1800).max(thisYear + 1).nullable().default(null),
    levels: z.array(z.enum(WEBSITE_LEVELS)).max(WEBSITE_LEVELS.length).default([]),
    curriculum: optionalText(WEBSITE_LIMITS.curriculum),
    boarding: z.enum(WEBSITE_BOARDING).nullable().default(null),
    gender: z.enum(WEBSITE_GENDERS).nullable().default(null),
    leaders: z.array(websiteLeaderSchema).max(WEBSITE_LIMITS.leaders).default([]),
    feesText: optionalText(WEBSITE_LIMITS.feesText),
    entryClassLevelIds: z.array(z.string().uuid()).max(40).default([]),
    visitNote: optionalText(WEBSITE_LIMITS.visitNote),
    accent: z.enum(WEBSITE_ACCENT_KEYS).nullable().default(null),
  })
  .strict();
export type WebsiteDetailsInput = z.input<typeof websiteDetailsSchema>;
export type WebsiteDetails = z.infer<typeof websiteDetailsSchema>;

export const EMPTY_WEBSITE_DETAILS: WebsiteDetails = websiteDetailsSchema.parse({});

// ─── The editor ─────────────────────────────────────────────────────────────

export interface WebsiteSectionStateDto {
  section: WebsiteSection;
  /** Open to this school now. */
  open: boolean;
  /** In the school's own plan (false while early access is lending it). */
  inPlan: boolean;
  /** The cheapest plan that opens it. */
  minPlan: SchoolPlan;
}

// GET /school-website
export interface SchoolWebsiteDto {
  draft: WebsiteDetails;
  /** Null until first published. */
  published: WebsiteDetails | null;
  publishedAt: string | null;
  /** The draft differs from what families see. */
  unpublishedChanges: boolean;
  plan: SchoolPlan;
  enforcement: PlanEnforcement;
  limits: WebsiteLimits;
  sections: WebsiteSectionStateDto[];
  /** The school's class levels, for the entry classes. */
  classLevels: { id: string; name: string }[];
  counts: { galleryPhotos: number; posts: number; publishedPosts: number; events: number; announcements: number };
  /** Where the page is. */
  pageUrl: string;
}

// POST /school-website/preview
export interface WebsitePreviewDto {
  /** Opens the page with the draft, for 30 minutes. */
  url: string;
  expiresAt: string;
}

// ─── Photos ─────────────────────────────────────────────────────────────────

export const WEBSITE_PHOTO_KINDS = ["COVER", "POST", "GALLERY", "LEADER"] as const;
export type WebsitePhotoKind = (typeof WEBSITE_PHOTO_KINDS)[number];

/** The rule (W4), as the uploader reads it beside the tick. */
export const WEBSITE_NO_PUPILS_TICK = "This photo shows no pupils.";
export const WEBSITE_PHOTO_RULE =
  "No pupils on the public website, even from behind or in a crowd. Buildings, classrooms, staff, trophies, the school bus and events without pupils are fine.";

/** Multipart fields beside `file` (large) and `thumb`. Strings, as multipart sends them. */
export const uploadWebsitePhotoSchema = z
  .object({
    kind: z.enum(WEBSITE_PHOTO_KINDS),
    postId: z.string().uuid().optional(),
    albumId: z.string().uuid().optional(),
    caption: z.string().trim().max(WEBSITE_LIMITS.caption).optional(),
    noPupils: z.literal("true", { errorMap: () => ({ message: "Tick “This photo shows no pupils” to upload it." }) }),
  })
  .strict()
  .refine((v) => (v.kind === "POST") === (v.postId !== undefined), { message: "A news photo belongs to one post.", path: ["postId"] })
  .refine((v) => v.albumId === undefined || v.kind === "GALLERY", { message: "Only gallery photos go in albums.", path: ["albumId"] });
export type UploadWebsitePhotoInput = z.infer<typeof uploadWebsitePhotoSchema>;

export const updateWebsitePhotoSchema = z
  .object({
    caption: z.string().trim().max(WEBSITE_LIMITS.caption).nullable().optional(),
    albumId: z.string().uuid().nullable().optional(),
    position: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update." });
export type UpdateWebsitePhotoInput = z.infer<typeof updateWebsitePhotoSchema>;

export interface WebsitePhotoDto {
  id: string;
  kind: WebsitePhotoKind;
  postId: string | null;
  albumId: string | null;
  caption: string | null;
  position: number;
  thumbUrl: string;
  largeUrl: string;
  createdAt: string;
  /** SchoolKit took it down; it no longer shows and cannot be republished. */
  takenDown: { at: string; reason: string } | null;
}

export const websiteAlbumSchema = z
  .object({ title: z.string().trim().min(1, "Give the album a name.").max(WEBSITE_LIMITS.albumTitle) })
  .strict();
export type WebsiteAlbumInput = z.infer<typeof websiteAlbumSchema>;

export interface WebsiteAlbumDto {
  id: string;
  title: string;
  photoCount: number;
}

// GET /school-website/photos?kind=
export interface WebsitePhotoListDto {
  photos: WebsitePhotoDto[];
  albums: WebsiteAlbumDto[];
}

// ─── News ───────────────────────────────────────────────────────────────────

export const WEBSITE_POST_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export type WebsitePostStatus = (typeof WEBSITE_POST_STATUSES)[number];

export const websitePostSchema = z
  .object({
    title: z.string().trim().min(1, "Give the post a title.").max(WEBSITE_LIMITS.postTitle),
    body: z.string().trim().min(1, "Write the post.").max(WEBSITE_LIMITS.postBody),
  })
  .strict();
export type WebsitePostInput = z.infer<typeof websitePostSchema>;

export const updateWebsitePostSchema = websitePostSchema.partial().refine((v) => Object.values(v).some((x) => x !== undefined), {
  message: "Nothing to update.",
});
export type UpdateWebsitePostInput = z.infer<typeof updateWebsitePostSchema>;

export interface WebsitePostDto {
  id: string;
  title: string;
  body: string;
  status: WebsitePostStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  photos: WebsitePhotoDto[];
  takenDown: { at: string; reason: string } | null;
}

// ─── Public page ────────────────────────────────────────────────────────────

export interface PublicWebsitePhotoDto {
  id: string;
  thumbUrl: string;
  largeUrl: string;
  caption: string | null;
}

export interface PublicWebsiteEventDto {
  id: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
}

export interface PublicWebsiteAnnouncementDto {
  id: string;
  title: string;
  body: string;
  date: string;
}

export interface PublicWebsitePostSummaryDto {
  id: string;
  title: string;
  /** The first lines of the body. */
  excerpt: string;
  publishedAt: string;
  photo: PublicWebsitePhotoDto | null;
}

export interface PublicWebsitePostDto {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  photos: PublicWebsitePhotoDto[];
}

/** The school's own sections, on GET /school-addresses/:code. */
export interface PublicWebsiteDto {
  accent: string | null;
  cover: { photo: PublicWebsitePhotoDto | null; welcome: string | null } | null;
  about: { headWelcome: string | null; headName: string | null; headTitle: string | null; story: string | null } | null;
  facts: { label: string; value: string }[];
  leaders: { name: string; role: string; photo: PublicWebsitePhotoDto | null }[];
  admissionsBox: { entryClasses: string[]; feesText: string | null; visitNote: string | null } | null;
  events: PublicWebsiteEventDto[];
  announcements: PublicWebsiteAnnouncementDto[];
  /** Null: no news on this plan. */
  news: { latest: PublicWebsitePostSummaryDto[]; total: number } | null;
  /** Null: no gallery on this plan. */
  gallery: { photos: PublicWebsitePhotoDto[]; total: number } | null;
  poweredBy: boolean;
  /** Shown with a preview link: the draft, not what families see. */
  preview: boolean;
}

// GET /school-addresses/:code/news?page=
export const WEBSITE_NEWS_PAGE_SIZE = 10;
export interface PublicWebsiteNewsDto {
  posts: PublicWebsitePostSummaryDto[];
  page: number;
  pages: number;
}

// GET /school-addresses/:code/gallery
export interface PublicWebsiteGalleryDto {
  albums: { id: string | null; title: string; photos: PublicWebsitePhotoDto[] }[];
}

// POST /school-addresses/:code/reports
export const websiteReportSchema = z
  .object({
    photoId: z.string().uuid().optional(),
    postId: z.string().uuid().optional(),
    reason: z.string().trim().min(3, "Tell us briefly what is wrong.").max(WEBSITE_LIMITS.reportReason),
  })
  .strict()
  .refine((v) => (v.photoId === undefined) !== (v.postId === undefined), { message: "Report one photo or one post." });
export type WebsiteReportInput = z.infer<typeof websiteReportSchema>;

// ─── SchoolKit's operator ───────────────────────────────────────────────────

// PATCH /school-website/announcements/:id and /school-website/events/:id
export const websiteShowSchema = z.object({ show: z.boolean() }).strict();
export type WebsiteShowInput = z.infer<typeof websiteShowSchema>;

export const websiteTakeDownSchema = z
  .object({
    photoId: z.string().uuid().optional(),
    postId: z.string().uuid().optional(),
    reason: z.string().trim().min(3, "Give the school a reason.").max(WEBSITE_LIMITS.takeDownReason),
  })
  .strict()
  .refine((v) => (v.photoId === undefined) !== (v.postId === undefined), { message: "Take down one photo or one post." });
export type WebsiteTakeDownInput = z.infer<typeof websiteTakeDownSchema>;

export interface WebsiteReportDto {
  id: string;
  photoId: string | null;
  postId: string | null;
  reason: string;
  createdAt: string;
}

// GET /platform-admin/schools/:schoolId/website
export interface PlatformWebsiteReviewDto {
  schoolId: string;
  reports: WebsiteReportDto[];
  photos: WebsitePhotoDto[];
  posts: { id: string; title: string; body: string; status: WebsitePostStatus; publishedAt: string | null; takenDown: { at: string; reason: string } | null }[];
}

// GET /platform-admin/website-reports
export interface PlatformWebsiteReportQueueDto {
  schools: { schoolId: string; name: string; slug: string; openReports: number }[];
}
