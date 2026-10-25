import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  NotFoundError,
  WEBSITE_NEWS_PAGE_SIZE,
  type PublicWebsiteGalleryDto,
  type PublicWebsiteNewsDto,
  type PublicWebsitePhotoDto,
  type PublicWebsitePostDto,
  type SchoolSitemapDto,
  type WebsiteReportInput,
} from "@school-kit/types";

import { schoolSeoUrls } from "../../common/school-site-url.js";
import { resolveSchoolCode } from "../../common/slug/school-code.js";
import { loadAdmissionSettings, openClassLevels } from "../admissions/admissions.shared.js";
import { StorageService } from "../../common/storage/storage.service.js";
import type { TenantDb } from "../attendance/shared/attendance-shared.util.js";
import { LIVE_PHOTO, LIVE_POST, postSummaries, readWebsiteLimits, signWebsitePhoto } from "./website-content.js";

// The school website's own public pages, beside the front page
// (docs/modules/school-website.md): the news list and each post, the
// gallery, and "Report this photo". PUBLIC: only published, live items, only
// the plan's allowance, and never who posted.

const NOT_FOUND = "There is no school at this address.";

@Injectable()
export class SchoolWebsitePublicService {
  constructor(private readonly storage: StorageService) {}

  private async school<T>(rawCode: string, fn: (db: TenantDb, schoolId: string) => Promise<T>): Promise<T> {
    const found = await resolveSchoolCode(rawCode);
    if (!found) throw new NotFoundError(NOT_FOUND);
    return withTenant(found.schoolId, async (db) => {
      const school = await db.school.findUnique({ where: { id: found.schoolId }, select: { suspendedAt: true } });
      if (!school || school.suspendedAt) throw new NotFoundError(NOT_FOUND);
      return fn(db, found.schoolId);
    });
  }

  async news(rawCode: string, rawPage: number): Promise<PublicWebsiteNewsDto> {
    return this.school(rawCode, async (db, schoolId) => {
      const { limits } = await readWebsiteLimits(db, schoolId);
      if (limits.news === 0) throw new NotFoundError("This school has no news here.");
      const total = await db.schoolWebsitePost.count({ where: LIVE_POST });
      const shown = limits.news === null ? total : Math.min(total, limits.news);
      const pages = Math.max(1, Math.ceil(shown / WEBSITE_NEWS_PAGE_SIZE));
      const page = Math.min(Math.max(1, Math.floor(rawPage) || 1), pages);
      const skip = (page - 1) * WEBSITE_NEWS_PAGE_SIZE;
      const rows = await db.schoolWebsitePost.findMany({
        where: LIVE_POST,
        orderBy: { publishedAt: "desc" },
        skip,
        take: Math.max(0, Math.min(WEBSITE_NEWS_PAGE_SIZE, shown - skip)),
        select: { id: true, title: true, body: true, publishedAt: true },
      });
      return { posts: await postSummaries(db, this.storage, schoolId, rows), page, pages };
    });
  }

  async post(rawCode: string, postId: string): Promise<PublicWebsitePostDto> {
    return this.school(rawCode, async (db, schoolId) => {
      const { limits } = await readWebsiteLimits(db, schoolId);
      if (limits.news === 0) throw new NotFoundError("Post not found.");
      const post = await db.schoolWebsitePost.findFirst({
        where: { id: postId, ...LIVE_POST },
        select: { id: true, title: true, body: true, publishedAt: true },
      });
      if (!post) throw new NotFoundError("Post not found.");
      // A plan that shows only the latest N posts shows only those, here too.
      if (limits.news !== null) {
        const newer = await db.schoolWebsitePost.count({ where: { ...LIVE_POST, publishedAt: { gt: post.publishedAt ?? new Date(0) } } });
        if (newer >= limits.news) throw new NotFoundError("Post not found.");
      }
      const photos = await db.schoolWebsitePhoto.findMany({
        where: { postId, ...LIVE_PHOTO },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        take: limits.photosPerPost,
        select: { id: true, caption: true },
      });
      return {
        id: post.id,
        title: post.title,
        body: post.body,
        publishedAt: (post.publishedAt ?? new Date()).toISOString(),
        photos: await Promise.all(photos.map((p) => signWebsitePhoto(this.storage, schoolId, p))),
      };
    });
  }

  /**
   * Every public page of one school, at its canonical address, for its
   * sitemap.xml (docs/modules/school-website.md, "Search"). Only what the
   * page itself shows: live posts within the plan, the gallery if it has
   * photos, the admission form while open, the result checker while in use.
   */
  async sitemap(rawCode: string): Promise<SchoolSitemapDto> {
    return this.school(rawCode, async (db, schoolId) => {
      const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { slug: true, updatedAt: true } });
      const urls = schoolSeoUrls(school.slug);
      const { limits } = await readWebsiteLimits(db, schoolId);
      const site = await db.schoolWebsite.findUnique({ where: { schoolId }, select: { publishedAt: true } });
      const posts =
        limits.news === 0
          ? []
          : await db.schoolWebsitePost.findMany({
              where: LIVE_POST,
              orderBy: { publishedAt: "desc" },
              take: limits.news ?? 1000,
              select: { id: true, publishedAt: true, updatedAt: true },
            });
      const galleryCount = limits.galleryPhotos > 0 ? await db.schoolWebsitePhoto.count({ where: { kind: "GALLERY", ...LIVE_PHOTO } }) : 0;
      const settings = await loadAdmissionSettings(db, schoolId);
      const admissionsOpen = settings.enabled && (await openClassLevels(db, schoolId, settings.closedClassLevelIds)).length > 0;
      const resultChecker = (await db.reportCard.findFirst({ where: { status: "RELEASED", accessMode: "PIN" }, select: { id: true } })) !== null;

      const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
      const latest = [site?.publishedAt, posts[0]?.publishedAt, school.updatedAt]
        .filter((d): d is Date => d instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const entries: SchoolSitemapDto["entries"] = [{ url: urls.home, lastModified: iso(latest) }];
      if (posts.length) {
        entries.push({ url: urls.news, lastModified: iso(posts[0]!.publishedAt) });
        for (const p of posts) entries.push({ url: `${urls.news}/${p.id}`, lastModified: iso(p.updatedAt ?? p.publishedAt) });
      }
      if (galleryCount > 0) entries.push({ url: urls.gallery, lastModified: null });
      if (admissionsOpen) entries.push({ url: urls.apply, lastModified: null });
      if (resultChecker) entries.push({ url: urls.results, lastModified: null });
      return { entries };
    });
  }

  async gallery(rawCode: string): Promise<PublicWebsiteGalleryDto> {
    return this.school(rawCode, async (db, schoolId) => {
      const { limits } = await readWebsiteLimits(db, schoolId);
      if (limits.galleryPhotos === 0) throw new NotFoundError("This school has no gallery here.");
      const [albums, photos] = await Promise.all([
        db.schoolWebsiteAlbum.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, title: true } }),
        db.schoolWebsitePhoto.findMany({
          where: { kind: "GALLERY", ...LIVE_PHOTO },
          orderBy: [{ position: "asc" }, { createdAt: "desc" }],
          take: limits.galleryPhotos,
          select: { id: true, caption: true, albumId: true },
        }),
      ]);
      const byAlbum = new Map<string | null, PublicWebsitePhotoDto[]>();
      for (const p of photos) {
        const list = byAlbum.get(p.albumId) ?? [];
        list.push(await signWebsitePhoto(this.storage, schoolId, p));
        byAlbum.set(p.albumId, list);
      }
      const out: PublicWebsiteGalleryDto["albums"] = albums
        .filter((a) => byAlbum.has(a.id))
        .map((a) => ({ id: a.id, title: a.title, photos: byAlbum.get(a.id)! }));
      const loose = byAlbum.get(null);
      if (loose?.length) out.push({ id: null, title: out.length ? "More photos" : "Photos", photos: loose });
      return { albums: out };
    });
  }

  /**
   * "Report this photo": a parent or anyone else flags a photo or post to
   * SchoolKit. Counted on schools.website_open_reports for the operator's
   * queue. Throttled at the controller; the reason is the reporter's words
   * and nothing about them is kept.
   */
  async report(rawCode: string, input: WebsiteReportInput): Promise<{ received: true }> {
    return this.school(rawCode, async (db, schoolId) => {
      if (input.photoId) {
        const photo = await db.schoolWebsitePhoto.findFirst({ where: { id: input.photoId, ...LIVE_PHOTO }, select: { id: true } });
        if (!photo) throw new NotFoundError("Photo not found.");
      } else {
        const post = await db.schoolWebsitePost.findFirst({ where: { id: input.postId!, ...LIVE_POST }, select: { id: true } });
        if (!post) throw new NotFoundError("Post not found.");
      }
      const row = await db.schoolWebsiteReport.create({
        data: { schoolId, photoId: input.photoId ?? null, postId: input.postId ?? null, reason: input.reason },
        select: { id: true },
      });
      await db.school.update({ where: { id: schoolId }, data: { websiteOpenReports: { increment: 1 } } });
      await db.auditLog.create({
        data: {
          schoolId,
          userId: null,
          action: "website.report",
          entityType: "school_website_report",
          entityId: row.id,
          metadata: { photoId: input.photoId ?? null, postId: input.postId ?? null },
        },
      });
      return { received: true as const };
    });
  }
}
