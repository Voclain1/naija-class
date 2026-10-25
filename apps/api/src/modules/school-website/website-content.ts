import { createHmac, timingSafeEqual } from "node:crypto";

import {
  EMPTY_WEBSITE_DETAILS,
  WEBSITE_BOARDING_LABELS,
  WEBSITE_ACCENTS,
  WEBSITE_EVENTS_MAX,
  WEBSITE_GENDER_LABELS,
  WEBSITE_LEVEL_LABELS,
  lagosTodayIso,
  websiteDetailsSchema,
  websiteLimitsFor,
  type PublicWebsiteDto,
  type PublicWebsitePhotoDto,
  type PublicWebsitePostSummaryDto,
  type SchoolPlan,
  type WebsiteDetails,
  type WebsiteLimits,
} from "@school-kit/types";

import type { TenantDb } from "../attendance/shared/attendance-shared.util.js";
import { currentPlanEnforcement } from "../../common/plans/plan-limits.js";
import type { StorageService } from "../../common/storage/storage.service.js";
import { resolveResultPinKey } from "../result-checker/result-pin-key.js";

// The school's public website (2026-10-22, docs/modules/school-website.md):
// the pieces the editor, the public page and SchoolKit's review share.
//
// Everything here takes the caller's tenant client, so every read runs under
// the one school's RLS.

/** Public photo links: an hour, renewed on every visit (like the logo). */
export const WEBSITE_PHOTO_TTL_SECONDS = 60 * 60;

export async function readWebsiteLimits(db: TenantDb, schoolId: string): Promise<{ plan: SchoolPlan; limits: WebsiteLimits }> {
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { plan: true } });
  return { plan: school.plan, limits: websiteLimitsFor(school.plan, currentPlanEnforcement()) };
}

/**
 * What search engines read (docs/modules/school-website.md, "Search"): the
 * published details (the draft for a preview) and when they were published.
 * The search fields are open to every plan; levels and founding year follow
 * the plan's page details, as on the page itself.
 */
export async function readSeoDetails(
  db: TenantDb,
  schoolId: string,
  preview: boolean,
): Promise<{ description: string | null; town: string | null; levels: string[]; founded: number | null; updatedAt: string | null }> {
  const { limits } = await readWebsiteLimits(db, schoolId);
  const site = await db.schoolWebsite.findUnique({ where: { schoolId }, select: { draft: true, published: true, publishedAt: true } });
  const d = site ? parseDetails(preview ? site.draft : site.published) : EMPTY_WEBSITE_DETAILS;
  return {
    description: d.searchDescription,
    town: d.town,
    levels: limits.details ? d.levels.map((l) => WEBSITE_LEVEL_LABELS[l]) : [],
    founded: limits.details ? d.founded : null,
    updatedAt: site?.publishedAt?.toISOString() ?? null,
  };
}

/** Stored details, re-checked on the way out; anything unreadable is empty. */
export function parseDetails(raw: unknown): WebsiteDetails {
  const parsed = websiteDetailsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : EMPTY_WEBSITE_DETAILS;
}

export async function signWebsitePhoto(
  storage: StorageService,
  schoolId: string,
  photo: { id: string; caption: string | null },
): Promise<PublicWebsitePhotoDto> {
  const [thumbUrl, largeUrl] = await Promise.all([
    storage.signUrl(schoolId, { kind: "website-photo", photoId: photo.id, size: "thumb" }, WEBSITE_PHOTO_TTL_SECONDS),
    storage.signUrl(schoolId, { kind: "website-photo", photoId: photo.id, size: "large" }, WEBSITE_PHOTO_TTL_SECONDS),
  ]);
  return { id: photo.id, thumbUrl, largeUrl, caption: photo.caption };
}

/** Photos that may show: not taken down. */
export const LIVE_PHOTO = { takenDownAt: null } as const;
/** Posts families may read. */
export const LIVE_POST = { status: "PUBLISHED", takenDownAt: null } as const;

export function excerpt(body: string, max = 220): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function factsOf(d: WebsiteDetails): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  if (d.founded) facts.push({ label: "Founded", value: String(d.founded) });
  if (d.levels.length) facts.push({ label: "Levels", value: d.levels.map((l) => WEBSITE_LEVEL_LABELS[l]).join(", ") });
  if (d.curriculum) facts.push({ label: "Curriculum", value: d.curriculum });
  if (d.boarding) facts.push({ label: "Day or boarding", value: WEBSITE_BOARDING_LABELS[d.boarding] });
  if (d.gender) facts.push({ label: "Pupils", value: WEBSITE_GENDER_LABELS[d.gender] });
  return facts;
}

/**
 * The school's own sections for the public page, by plan. `details` is the
 * published version, or the draft for a preview. Only live items, only the
 * plan's allowance, and nothing about a pupil, a parent or who posted.
 */
export async function buildPublicWebsite(
  db: TenantDb,
  storage: StorageService,
  schoolId: string,
  opts: { preview: boolean; admissionsOpen: boolean },
): Promise<PublicWebsiteDto> {
  const { limits } = await readWebsiteLimits(db, schoolId);
  const site = await db.schoolWebsite.findUnique({ where: { schoolId }, select: { draft: true, published: true } });
  const details = site ? parseDetails(opts.preview ? site.draft : site.published) : EMPTY_WEBSITE_DETAILS;
  const today = lagosTodayIso();

  // Photos the details point at, signed once each.
  const wanted = [details.coverPhotoId, ...details.leaders.map((l) => l.photoId)].filter((id): id is string => !!id);
  const detailPhotos = wanted.length
    ? await db.schoolWebsitePhoto.findMany({ where: { id: { in: wanted }, ...LIVE_PHOTO }, select: { id: true, caption: true } })
    : [];
  const signed = new Map<string, PublicWebsitePhotoDto>();
  for (const p of detailPhotos) signed.set(p.id, await signWebsitePhoto(storage, schoolId, p));
  const photo = (id: string | null) => (id ? (signed.get(id) ?? null) : null);

  const [events, announcements] = await Promise.all([
    db.schoolEvent.findMany({
      where: { showOnWebsite: true, endDate: { gte: new Date(`${today}T00:00:00.000Z`) } },
      orderBy: [{ startDate: "asc" }, { title: "asc" }],
      take: limits.events ?? WEBSITE_EVENTS_MAX,
      select: { id: true, title: true, description: true, startDate: true, endDate: true },
    }),
    db.announcement.findMany({
      where: { showOnWebsite: true, withdrawnAt: null, audience: { in: ["EVERYONE", "PARENTS"] } },
      orderBy: { createdAt: "desc" },
      take: limits.announcements,
      select: { id: true, title: true, body: true, createdAt: true },
    }),
  ]);

  let news: PublicWebsiteDto["news"] = null;
  if (limits.news !== 0) {
    const total = await db.schoolWebsitePost.count({ where: LIVE_POST });
    const latest = await db.schoolWebsitePost.findMany({
      where: LIVE_POST,
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: { id: true, title: true, body: true, publishedAt: true },
    });
    news = { latest: await postSummaries(db, storage, schoolId, latest), total: limits.news === null ? total : Math.min(total, limits.news) };
  }

  let gallery: PublicWebsiteDto["gallery"] = null;
  if (limits.galleryPhotos > 0) {
    const total = await db.schoolWebsitePhoto.count({ where: { kind: "GALLERY", ...LIVE_PHOTO } });
    const rows = await db.schoolWebsitePhoto.findMany({
      where: { kind: "GALLERY", ...LIVE_PHOTO },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
      take: Math.min(12, limits.galleryPhotos),
      select: { id: true, caption: true },
    });
    gallery = { photos: await Promise.all(rows.map((r) => signWebsitePhoto(storage, schoolId, r))), total: Math.min(total, limits.galleryPhotos) };
  }

  let admissionsBox: PublicWebsiteDto["admissionsBox"] = null;
  if (limits.admissionsBox && opts.admissionsOpen && (details.feesText || details.visitNote || details.entryClassLevelIds.length)) {
    const levels = details.entryClassLevelIds.length
      ? await db.classLevel.findMany({ where: { id: { in: details.entryClassLevelIds } }, orderBy: { orderIndex: "asc" }, select: { name: true } })
      : [];
    admissionsBox = { entryClasses: levels.map((l) => l.name), feesText: details.feesText, visitNote: details.visitNote };
  }

  const hasAbout = details.headWelcome || details.story;
  return {
    accent: limits.accent && details.accent ? WEBSITE_ACCENTS[details.accent].hex : null,
    cover:
      limits.details && (details.coverPhotoId || details.welcome)
        ? { photo: photo(details.coverPhotoId), welcome: details.welcome }
        : null,
    about:
      limits.details && hasAbout
        ? { headWelcome: details.headWelcome, headName: details.headName, headTitle: details.headTitle, story: details.story }
        : null,
    facts: limits.details ? factsOf(details) : [],
    leaders: details.leaders.slice(0, limits.leaders).map((l) => ({ name: l.name, role: l.role, photo: photo(l.photoId) })),
    admissionsBox,
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      startDate: e.startDate.toISOString().slice(0, 10),
      endDate: e.endDate.toISOString().slice(0, 10),
    })),
    announcements: announcements.map((a) => ({ id: a.id, title: a.title, body: a.body, date: a.createdAt.toISOString() })),
    news,
    gallery,
    poweredBy: limits.poweredBy,
    preview: opts.preview,
  };
}

export async function postSummaries(
  db: TenantDb,
  storage: StorageService,
  schoolId: string,
  posts: { id: string; title: string; body: string; publishedAt: Date | null }[],
): Promise<PublicWebsitePostSummaryDto[]> {
  if (posts.length === 0) return [];
  const photos = await db.schoolWebsitePhoto.findMany({
    where: { postId: { in: posts.map((p) => p.id) }, ...LIVE_PHOTO },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, caption: true, postId: true },
  });
  const first = new Map<string, { id: string; caption: string | null }>();
  for (const p of photos) if (p.postId && !first.has(p.postId)) first.set(p.postId, p);
  return Promise.all(
    posts.map(async (p) => {
      const f = first.get(p.id);
      return {
        id: p.id,
        title: p.title,
        excerpt: excerpt(p.body),
        publishedAt: (p.publishedAt ?? new Date()).toISOString(),
        photo: f ? await signWebsitePhoto(storage, schoolId, f) : null,
      };
    }),
  );
}

// ─── Preview links ──────────────────────────────────────────────────────────
// "Preview" opens the real page with the draft in place of the published
// details, for 30 minutes. The token is an HMAC of the school and the expiry
// under the server key (the result-checker key, under a label of its own, as
// admission tracking links are), so it cannot be made for another school or
// stretched. It shows only what the school's own staff wrote.

const PREVIEW_LABEL = "website-preview:v1:";
export const PREVIEW_TTL_MS = 30 * 60 * 1000;

function previewSignature(schoolId: string, expires: number, key: string): string {
  return createHmac("sha256", key).update(`${PREVIEW_LABEL}${schoolId}:${expires}`).digest("base64url");
}

export function makePreviewToken(schoolId: string, now: Date = new Date(), key: string = resolveResultPinKey()): { token: string; expiresAt: Date } {
  const expires = now.getTime() + PREVIEW_TTL_MS;
  return { token: `${expires}.${previewSignature(schoolId, expires, key)}`, expiresAt: new Date(expires) };
}

export function verifyPreviewToken(schoolId: string, token: string | undefined, now: Date = new Date(), key: string = resolveResultPinKey()): boolean {
  if (!token) return false;
  const [rawExpires, sig] = token.split(".");
  const expires = Number(rawExpires);
  if (!sig || !Number.isSafeInteger(expires) || expires < now.getTime()) return false;
  const expected = Buffer.from(previewSignature(schoolId, expires, key));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
