import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PLAN_ERROR_CODES,
  ValidationError,
  WEBSITE_LIMITS,
  WEBSITE_SECTIONS,
  WEBSITE_PLAN_LIMITS,
  websiteSectionMinPlan,
  websiteSectionOpen,
  type SchoolWebsiteDto,
  type UpdateWebsitePhotoInput,
  type UpdateWebsitePostInput,
  type UploadWebsitePhotoInput,
  type WebsiteAlbumDto,
  type WebsiteAlbumInput,
  type WebsiteDetails,
  type WebsiteDetailsInput,
  type WebsitePhotoDto,
  type WebsitePhotoKind,
  type WebsitePhotoListDto,
  type WebsitePostDto,
  type WebsitePostInput,
  type WebsitePreviewDto,
  websiteDetailsSchema,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { currentPlanEnforcement } from "../../common/plans/plan-limits.js";
import { schoolSiteUrls } from "../../common/school-site-url.js";
import { sniffPrivateFile } from "../../common/storage/private-file.js";
import { StorageService } from "../../common/storage/storage.service.js";
import type { TenantDb } from "../attendance/shared/attendance-shared.util.js";
import { WEBSITE_PHOTO_TTL_SECONDS, makePreviewToken, parseDetails, readWebsiteLimits } from "./website-content.js";

// Settings → School website (2026-10-22, docs/modules/school-website.md).
// Owner and admin (website.manage): the page details as a draft and as
// published, news posts, the gallery, and photos.
//
// Nothing is deleted when a plan stops covering a section; the public page
// simply stops showing it (W3, like report-card branding). What IS refused
// under PLAN_ENFORCEMENT=enforce is adding more than the plan holds.
//
// W4: no pupils on public pages. Every upload carries the uploader's tick
// "This photo shows no pupils", recorded with who gave it; SchoolKit can take
// any photo or post down, and the school cannot republish it.

interface RequestContext {
  ipAddress: string | null;
}

export interface UploadedWebsitePhoto {
  large: Buffer;
  thumb: Buffer;
}

const AUDIT = {
  draft: "website.draft.save",
  publish: "website.publish",
  photoUpload: "website.photo.upload",
  photoUpdate: "website.photo.update",
  photoDelete: "website.photo.delete",
  albumCreate: "website.album.create",
  albumUpdate: "website.album.update",
  albumDelete: "website.album.delete",
  postCreate: "website.post.create",
  postUpdate: "website.post.update",
  postDelete: "website.post.delete",
  postPublish: "website.post.publish",
  postUnpublish: "website.post.unpublish",
} as const;

/** Ceilings on the photos that hold the page details, whatever the plan. */
const KIND_CEILING: Record<Exclude<WebsitePhotoKind, "POST" | "GALLERY">, number> = { COVER: 10, LEADER: 24 };

const PHOTO_SELECT = {
  id: true,
  kind: true,
  postId: true,
  albumId: true,
  caption: true,
  position: true,
  createdAt: true,
  takenDownAt: true,
  takeDownReason: true,
} as const;

type PhotoRow = {
  id: string;
  kind: WebsitePhotoKind;
  postId: string | null;
  albumId: string | null;
  caption: string | null;
  position: number;
  createdAt: Date;
  takenDownAt: Date | null;
  takeDownReason: string | null;
};

const POST_SELECT = {
  id: true,
  title: true,
  body: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  takenDownAt: true,
  takeDownReason: true,
} as const;

function takenDown(row: { takenDownAt: Date | null; takeDownReason: string | null }) {
  return row.takenDownAt ? { at: row.takenDownAt.toISOString(), reason: row.takeDownReason ?? "" } : null;
}

/** Throws unless the bytes are a JPEG within the size. */
export function assertWebsiteJpeg(buffer: Buffer, maxBytes: number, label: string): void {
  if (buffer.length === 0) throw new ValidationError("INVALID_UPLOAD", `The ${label} is empty.`);
  if (buffer.length > maxBytes) {
    throw new ValidationError("FILE_TOO_LARGE", `The ${label} is too large. Try a smaller photo.`);
  }
  if (sniffPrivateFile(buffer)?.ext !== "jpg") {
    throw new ValidationError("INVALID_FILE_TYPE", `The ${label} must be a JPEG.`);
  }
}

function planLimitError(message: string): ForbiddenError {
  return new ForbiddenError(PLAN_ERROR_CODES.FEATURE_UNAVAILABLE, message);
}

@Injectable()
export class SchoolWebsiteService {
  constructor(private readonly storage: StorageService) {}

  // ───────────────────────────────────────────────────────── page details

  async get(authCtx: AuthContext): Promise<SchoolWebsiteDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, (db) => this.view(db, authCtx.schoolId));
  }

  async saveDraft(authCtx: AuthContext, input: WebsiteDetailsInput, reqCtx: RequestContext): Promise<SchoolWebsiteDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    const details = websiteDetailsSchema.parse(input);
    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertDetailRefs(db, details);
      await db.schoolWebsite.upsert({
        where: { schoolId: authCtx.schoolId },
        create: { schoolId: authCtx.schoolId, draft: details, updatedBy: authCtx.userId },
        update: { draft: details, updatedBy: authCtx.userId },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.draft,
          entityType: "school_website",
          entityId: authCtx.schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: { leaders: details.leaders.length, cover: details.coverPhotoId !== null },
        },
      });
      return this.view(db, authCtx.schoolId);
    });
  }

  /** Families now see the saved draft. */
  async publish(authCtx: AuthContext, reqCtx: RequestContext): Promise<SchoolWebsiteDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const site = await db.schoolWebsite.findUnique({ where: { schoolId: authCtx.schoolId }, select: { draft: true } });
      const draft = parseDetails(site?.draft);
      // Photos may have been taken down or deleted since the draft was saved.
      await this.assertDetailRefs(db, draft);
      const now = new Date();
      await db.schoolWebsite.upsert({
        where: { schoolId: authCtx.schoolId },
        create: { schoolId: authCtx.schoolId, draft, published: draft, publishedAt: now, publishedBy: authCtx.userId, updatedBy: authCtx.userId },
        update: { published: draft, publishedAt: now, publishedBy: authCtx.userId },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.publish,
          entityType: "school_website",
          entityId: authCtx.schoolId,
          ipAddress: reqCtx.ipAddress,
        },
      });
      return this.view(db, authCtx.schoolId);
    });
  }

  /** A 30-minute link to the page with the draft in place. */
  async preview(authCtx: AuthContext): Promise<WebsitePreviewDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    const slug = await withTenant(authCtx.schoolId, async (db) => {
      const school = await db.school.findUniqueOrThrow({ where: { id: authCtx.schoolId }, select: { slug: true } });
      return school.slug;
    });
    const { token, expiresAt } = makePreviewToken(authCtx.schoolId);
    return { url: `${schoolSiteUrls(slug).home}?preview=${encodeURIComponent(token)}`, expiresAt: expiresAt.toISOString() };
  }

  private async view(db: TenantDb, schoolId: string): Promise<SchoolWebsiteDto> {
    const { plan, limits } = await readWebsiteLimits(db, schoolId);
    const enforcement = currentPlanEnforcement();
    const [site, school, classLevels, galleryPhotos, posts, publishedPosts, events, announcements] = await Promise.all([
      db.schoolWebsite.findUnique({ where: { schoolId }, select: { draft: true, published: true, publishedAt: true } }),
      db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { slug: true } }),
      db.classLevel.findMany({ orderBy: { orderIndex: "asc" }, select: { id: true, name: true } }),
      db.schoolWebsitePhoto.count({ where: { kind: "GALLERY" } }),
      db.schoolWebsitePost.count(),
      db.schoolWebsitePost.count({ where: { status: "PUBLISHED", takenDownAt: null } }),
      db.schoolEvent.count({ where: { showOnWebsite: true } }),
      db.announcement.count({ where: { showOnWebsite: true, withdrawnAt: null } }),
    ]);
    const draft = parseDetails(site?.draft);
    const published = site?.published ? parseDetails(site.published) : null;
    return {
      draft,
      published,
      publishedAt: site?.publishedAt?.toISOString() ?? null,
      unpublishedChanges: JSON.stringify(draft) !== JSON.stringify(published),
      plan,
      enforcement,
      limits,
      sections: WEBSITE_SECTIONS.map((section) => ({
        section,
        open: websiteSectionOpen(limits, section),
        inPlan: websiteSectionOpen(WEBSITE_PLAN_LIMITS[plan], section),
        minPlan: websiteSectionMinPlan(section),
      })),
      classLevels,
      counts: { galleryPhotos, posts, publishedPosts, events, announcements },
      pageUrl: schoolSiteUrls(school.slug).home,
    };
  }

  /** The cover and leader photos must be this school's, of the right kind and live; entry classes must exist. */
  private async assertDetailRefs(db: TenantDb, d: WebsiteDetails): Promise<void> {
    const refs: { id: string; kind: WebsitePhotoKind }[] = [];
    if (d.coverPhotoId) refs.push({ id: d.coverPhotoId, kind: "COVER" });
    for (const l of d.leaders) if (l.photoId) refs.push({ id: l.photoId, kind: "LEADER" });
    if (refs.length) {
      const rows = await db.schoolWebsitePhoto.findMany({
        where: { id: { in: refs.map((r) => r.id) } },
        select: { id: true, kind: true, takenDownAt: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const ref of refs) {
        const row = byId.get(ref.id);
        if (!row || row.kind !== ref.kind) throw new ValidationError("WEBSITE_PHOTO_MISSING", "A photo on the page is no longer there. Choose it again.");
        if (row.takenDownAt) throw new ValidationError("WEBSITE_PHOTO_TAKEN_DOWN", "A photo on the page was taken down by SchoolKit. Choose another.");
      }
    }
    if (d.entryClassLevelIds.length) {
      const found = await db.classLevel.count({ where: { id: { in: d.entryClassLevelIds } } });
      if (found !== new Set(d.entryClassLevelIds).size) throw new ValidationError("CLASS_LEVEL_NOT_FOUND", "One of the entry classes no longer exists.");
    }
  }

  // ─────────────────────────────────────────────────────────────── photos

  async listPhotos(authCtx: AuthContext, kind: WebsitePhotoKind | undefined): Promise<WebsitePhotoListDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const [rows, albums] = await Promise.all([
        db.schoolWebsitePhoto.findMany({
          where: kind ? { kind } : {},
          orderBy: [{ position: "asc" }, { createdAt: "desc" }],
          select: PHOTO_SELECT,
          take: 500,
        }),
        this.albums(db),
      ]);
      return { photos: await Promise.all(rows.map((r) => this.photoDto(authCtx.schoolId, r))), albums };
    });
  }

  async uploadPhoto(
    authCtx: AuthContext,
    files: UploadedWebsitePhoto,
    input: UploadWebsitePhotoInput,
    reqCtx: RequestContext,
  ): Promise<WebsitePhotoDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    assertWebsiteJpeg(files.large, WEBSITE_LIMITS.photoBytes, "photo");
    assertWebsiteJpeg(files.thumb, WEBSITE_LIMITS.thumbBytes, "thumbnail");

    return withTenant(authCtx.schoolId, async (db) => {
      const { limits } = await readWebsiteLimits(db, authCtx.schoolId);
      if (input.kind === "POST") {
        const post = await db.schoolWebsitePost.findUnique({ where: { id: input.postId! }, select: { takenDownAt: true } });
        if (!post) throw new NotFoundError("Post not found.");
        if (post.takenDownAt) throw new ConflictError("WEBSITE_TAKEN_DOWN", "SchoolKit took this post down, so it cannot change.");
        const count = await db.schoolWebsitePhoto.count({ where: { postId: input.postId! } });
        if (count >= WEBSITE_LIMITS.photosPerPost) throw new ValidationError("WEBSITE_PHOTO_LIMIT", `A post holds up to ${WEBSITE_LIMITS.photosPerPost} photos.`);
        if (count >= limits.photosPerPost) throw planLimitError(`Your plan allows ${limits.photosPerPost} photos on each post.`);
      } else if (input.kind === "GALLERY") {
        const count = await db.schoolWebsitePhoto.count({ where: { kind: "GALLERY" } });
        if (count >= WEBSITE_LIMITS.galleryPhotos) throw new ValidationError("WEBSITE_PHOTO_LIMIT", `The gallery holds up to ${WEBSITE_LIMITS.galleryPhotos} photos.`);
        if (count >= limits.galleryPhotos) {
          throw planLimitError(limits.galleryPhotos === 0 ? "The photo gallery comes with the Growth plan." : `Your plan's gallery holds ${limits.galleryPhotos} photos.`);
        }
        if (input.albumId && !(await db.schoolWebsiteAlbum.findUnique({ where: { id: input.albumId }, select: { id: true } }))) {
          throw new NotFoundError("Album not found.");
        }
      } else {
        const count = await db.schoolWebsitePhoto.count({ where: { kind: input.kind } });
        if (count >= KIND_CEILING[input.kind]) {
          throw new ValidationError("WEBSITE_PHOTO_LIMIT", "You have many photos of this kind already. Delete one you no longer use.");
        }
      }

      const row = await db.schoolWebsitePhoto.create({
        data: {
          schoolId: authCtx.schoolId,
          kind: input.kind,
          postId: input.postId ?? null,
          albumId: input.albumId ?? null,
          caption: input.caption?.length ? input.caption : null,
          noPupilsConfirmedBy: authCtx.userId,
        },
        select: PHOTO_SELECT,
      });
      await this.storage.put(authCtx.schoolId, { kind: "website-photo", photoId: row.id, size: "large" }, files.large, "image/jpeg");
      await this.storage.put(authCtx.schoolId, { kind: "website-photo", photoId: row.id, size: "thumb" }, files.thumb, "image/jpeg");
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.photoUpload,
          entityType: "school_website_photo",
          entityId: row.id,
          ipAddress: reqCtx.ipAddress,
          // The tick is the uploader's own statement; recorded with them.
          metadata: { kind: row.kind, postId: row.postId, noPupilsConfirmed: true, size: files.large.length },
        },
      });
      return this.photoDto(authCtx.schoolId, row);
    });
  }

  async updatePhoto(authCtx: AuthContext, id: string, input: UpdateWebsitePhotoInput, reqCtx: RequestContext): Promise<WebsitePhotoDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.schoolWebsitePhoto.findUnique({ where: { id }, select: { kind: true } });
      if (!existing) throw new NotFoundError("Photo not found.");
      if (input.albumId) {
        if (existing.kind !== "GALLERY") throw new ValidationError("WEBSITE_ALBUM_KIND", "Only gallery photos go in albums.");
        if (!(await db.schoolWebsiteAlbum.findUnique({ where: { id: input.albumId }, select: { id: true } }))) throw new NotFoundError("Album not found.");
      }
      const row = await db.schoolWebsitePhoto.update({
        where: { id },
        data: {
          ...(input.caption !== undefined ? { caption: input.caption?.length ? input.caption : null } : {}),
          ...(input.albumId !== undefined ? { albumId: input.albumId } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
        },
        select: PHOTO_SELECT,
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.photoUpdate,
          entityType: "school_website_photo",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { changed: Object.keys(input) },
        },
      });
      return this.photoDto(authCtx.schoolId, row);
    });
  }

  async deletePhoto(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.schoolWebsitePhoto.findUnique({ where: { id }, select: { kind: true } });
      if (!existing) throw new NotFoundError("Photo not found.");
      await db.schoolWebsitePhoto.delete({ where: { id } });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.photoDelete,
          entityType: "school_website_photo",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { kind: existing.kind },
        },
      });
    });
    await this.deletePhotoFiles(authCtx.schoolId, [id]);
  }

  private async deletePhotoFiles(schoolId: string, ids: string[]): Promise<void> {
    for (const photoId of ids) {
      for (const size of ["large", "thumb"] as const) {
        await this.storage.delete(schoolId, { kind: "website-photo", photoId, size }).catch(() => undefined);
      }
    }
  }

  async photoDto(schoolId: string, row: PhotoRow): Promise<WebsitePhotoDto> {
    const [thumbUrl, largeUrl] = await Promise.all([
      this.storage.signUrl(schoolId, { kind: "website-photo", photoId: row.id, size: "thumb" }, WEBSITE_PHOTO_TTL_SECONDS),
      this.storage.signUrl(schoolId, { kind: "website-photo", photoId: row.id, size: "large" }, WEBSITE_PHOTO_TTL_SECONDS),
    ]);
    return {
      id: row.id,
      kind: row.kind,
      postId: row.postId,
      albumId: row.albumId,
      caption: row.caption,
      position: row.position,
      thumbUrl,
      largeUrl,
      createdAt: row.createdAt.toISOString(),
      takenDown: takenDown(row),
    };
  }

  // ─────────────────────────────────────────────────────────────── albums

  private async albums(db: TenantDb): Promise<WebsiteAlbumDto[]> {
    const rows = await db.schoolWebsiteAlbum.findMany({
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, _count: { select: { photos: true } } },
    });
    return rows.map((r) => ({ id: r.id, title: r.title, photoCount: r._count.photos }));
  }

  async createAlbum(authCtx: AuthContext, input: WebsiteAlbumInput, reqCtx: RequestContext): Promise<WebsiteAlbumDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      if ((await db.schoolWebsiteAlbum.count()) >= WEBSITE_LIMITS.albums) {
        throw new ValidationError("WEBSITE_ALBUM_LIMIT", `You can have up to ${WEBSITE_LIMITS.albums} albums.`);
      }
      const row = await db.schoolWebsiteAlbum.create({ data: { schoolId: authCtx.schoolId, title: input.title }, select: { id: true, title: true } });
      await db.auditLog.create({
        data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action: AUDIT.albumCreate, entityType: "school_website_album", entityId: row.id, ipAddress: reqCtx.ipAddress },
      });
      return { ...row, photoCount: 0 };
    });
  }

  async renameAlbum(authCtx: AuthContext, id: string, input: WebsiteAlbumInput, reqCtx: RequestContext): Promise<WebsiteAlbumDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      if (!(await db.schoolWebsiteAlbum.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundError("Album not found.");
      const row = await db.schoolWebsiteAlbum.update({
        where: { id },
        data: { title: input.title },
        select: { id: true, title: true, _count: { select: { photos: true } } },
      });
      await db.auditLog.create({
        data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action: AUDIT.albumUpdate, entityType: "school_website_album", entityId: id, ipAddress: reqCtx.ipAddress },
      });
      return { id: row.id, title: row.title, photoCount: row._count.photos };
    });
  }

  /** The album goes; its photos stay in the gallery, outside any album. */
  async deleteAlbum(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    await withTenant(authCtx.schoolId, async (db) => {
      if (!(await db.schoolWebsiteAlbum.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundError("Album not found.");
      await db.schoolWebsiteAlbum.delete({ where: { id } });
      await db.auditLog.create({
        data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action: AUDIT.albumDelete, entityType: "school_website_album", entityId: id, ipAddress: reqCtx.ipAddress },
      });
    });
  }

  // ───────────────────────────────────────────────────────────────── news

  async listPosts(authCtx: AuthContext): Promise<WebsitePostDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.schoolWebsitePost.findMany({ orderBy: { createdAt: "desc" }, take: 200, select: POST_SELECT });
      return this.postDtos(db, authCtx.schoolId, rows);
    });
  }

  async createPost(authCtx: AuthContext, input: WebsitePostInput, reqCtx: RequestContext): Promise<WebsitePostDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.schoolWebsitePost.create({
        data: { schoolId: authCtx.schoolId, title: input.title, body: input.body, createdBy: authCtx.userId },
        select: POST_SELECT,
      });
      await db.auditLog.create({
        data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action: AUDIT.postCreate, entityType: "school_website_post", entityId: row.id, ipAddress: reqCtx.ipAddress },
      });
      return (await this.postDtos(db, authCtx.schoolId, [row]))[0]!;
    });
  }

  async updatePost(authCtx: AuthContext, id: string, input: UpdateWebsitePostInput, reqCtx: RequestContext): Promise<WebsitePostDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      await this.livePost(db, id);
      const row = await db.schoolWebsitePost.update({
        where: { id },
        data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.body !== undefined ? { body: input.body } : {}) },
        select: POST_SELECT,
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.postUpdate,
          entityType: "school_website_post",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { changed: Object.keys(input) },
        },
      });
      return (await this.postDtos(db, authCtx.schoolId, [row]))[0]!;
    });
  }

  async setPostPublished(authCtx: AuthContext, id: string, publish: boolean, reqCtx: RequestContext): Promise<WebsitePostDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await this.livePost(db, id);
      if (publish) {
        const { limits } = await readWebsiteLimits(db, authCtx.schoolId);
        if (limits.news === 0) throw planLimitError("News on the website comes with the Starter plan.");
      }
      const row = await db.schoolWebsitePost.update({
        where: { id },
        data: publish
          ? { status: "PUBLISHED", publishedAt: existing.publishedAt ?? new Date() }
          : { status: "DRAFT" },
        select: POST_SELECT,
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: publish ? AUDIT.postPublish : AUDIT.postUnpublish,
          entityType: "school_website_post",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
        },
      });
      return (await this.postDtos(db, authCtx.schoolId, [row]))[0]!;
    });
  }

  async deletePost(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    const photoIds = await withTenant(authCtx.schoolId, async (db) => {
      if (!(await db.schoolWebsitePost.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundError("Post not found.");
      const photos = await db.schoolWebsitePhoto.findMany({ where: { postId: id }, select: { id: true } });
      await db.schoolWebsitePost.delete({ where: { id } });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.postDelete,
          entityType: "school_website_post",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { photos: photos.length },
        },
      });
      return photos.map((p) => p.id);
    });
    await this.deletePhotoFiles(authCtx.schoolId, photoIds);
  }

  /** The post, unless it is gone or SchoolKit took it down. */
  private async livePost(db: TenantDb, id: string): Promise<{ publishedAt: Date | null }> {
    const post = await db.schoolWebsitePost.findUnique({ where: { id }, select: { publishedAt: true, takenDownAt: true } });
    if (!post) throw new NotFoundError("Post not found.");
    if (post.takenDownAt) throw new ConflictError("WEBSITE_TAKEN_DOWN", "SchoolKit took this post down, so it cannot change or go back up.");
    return post;
  }

  private async postDtos(
    db: TenantDb,
    schoolId: string,
    rows: {
      id: string;
      title: string;
      body: string;
      status: "DRAFT" | "PUBLISHED";
      publishedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      createdBy: string;
      takenDownAt: Date | null;
      takeDownReason: string | null;
    }[],
  ): Promise<WebsitePostDto[]> {
    if (rows.length === 0) return [];
    const [photos, authors] = await Promise.all([
      db.schoolWebsitePhoto.findMany({
        where: { postId: { in: rows.map((r) => r.id) } },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: PHOTO_SELECT,
      }),
      db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdBy))] } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const name = new Map(authors.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    const byPost = new Map<string, WebsitePhotoDto[]>();
    for (const p of photos) {
      const list = byPost.get(p.postId!) ?? [];
      list.push(await this.photoDto(schoolId, p));
      byPost.set(p.postId!, list);
    }
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      status: r.status,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      authorName: name.get(r.createdBy) ?? null,
      photos: byPost.get(r.id) ?? [],
      takenDown: takenDown(r),
    }));
  }
}
