import { Injectable } from "@nestjs/common";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type PlatformWebsiteReportQueueDto,
  type PlatformWebsiteReviewDto,
  type WebsiteTakeDownInput,
} from "@school-kit/types";

import type { PlatformAdminContext } from "../../common/auth/platform-admin-context.js";
import type { TenantDb } from "../attendance/shared/attendance-shared.util.js";
import { SchoolWebsiteService } from "./school-website.service.js";

// SchoolKit's side of the school website (docs/modules/school-website.md):
// the queue of schools with reports from the public page, one school's
// photos and posts, and the take-down. W4: a photo of pupils that got
// through is SchoolKit's to take down; the school sees the reason and cannot
// republish it.
//
// The queue reads schools.website_open_reports (schools has no RLS), so it
// never reads another school's reports; everything else runs under the one
// school's GUC.

interface RequestContext {
  ipAddress: string | null;
}

const AUDIT = {
  review: "platform_admin.website.review",
  takeDown: "platform_admin.website.take-down",
  dismiss: "platform_admin.website.dismiss-report",
} as const;

@Injectable()
export class SchoolWebsitePlatformService {
  constructor(private readonly website: SchoolWebsiteService) {}

  async queue(): Promise<PlatformWebsiteReportQueueDto> {
    const rows = await basePrisma.school.findMany({
      where: { websiteOpenReports: { gt: 0 } },
      orderBy: { websiteOpenReports: "desc" },
      select: { id: true, name: true, slug: true, websiteOpenReports: true },
      take: 200,
    });
    return { schools: rows.map((r) => ({ schoolId: r.id, name: r.name, slug: r.slug, openReports: r.websiteOpenReports })) };
  }

  async review(schoolId: string, adminCtx: PlatformAdminContext, reqCtx: RequestContext): Promise<PlatformWebsiteReviewDto> {
    await this.assertSchool(schoolId);
    const result = await withTenant(schoolId, async (db) => {
      const [reports, photos, posts] = await Promise.all([
        db.schoolWebsiteReport.findMany({
          where: { resolvedAt: null },
          orderBy: { createdAt: "asc" },
          select: { id: true, photoId: true, postId: true, reason: true, createdAt: true },
        }),
        db.schoolWebsitePhoto.findMany({
          orderBy: { createdAt: "desc" },
          take: 500,
          select: { id: true, kind: true, postId: true, albumId: true, caption: true, position: true, createdAt: true, takenDownAt: true, takeDownReason: true },
        }),
        db.schoolWebsitePost.findMany({
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { id: true, title: true, body: true, status: true, publishedAt: true, takenDownAt: true, takeDownReason: true },
        }),
      ]);
      return {
        schoolId,
        reports: reports.map((r) => ({ id: r.id, photoId: r.photoId, postId: r.postId, reason: r.reason, createdAt: r.createdAt.toISOString() })),
        photos: await Promise.all(photos.map((p) => this.website.photoDto(schoolId, p))),
        posts: posts.map((p) => ({
          id: p.id,
          title: p.title,
          body: p.body,
          status: p.status,
          publishedAt: p.publishedAt?.toISOString() ?? null,
          takenDown: p.takenDownAt ? { at: p.takenDownAt.toISOString(), reason: p.takeDownReason ?? "" } : null,
        })),
      };
    });
    await this.audit(adminCtx, AUDIT.review, schoolId, reqCtx, { reports: result.reports.length });
    return result;
  }

  async takeDown(schoolId: string, input: WebsiteTakeDownInput, adminCtx: PlatformAdminContext, reqCtx: RequestContext): Promise<void> {
    await this.assertSchool(schoolId);
    const now = new Date();
    await withTenant(schoolId, async (db) => {
      if (input.photoId) {
        const photo = await db.schoolWebsitePhoto.findUnique({ where: { id: input.photoId }, select: { takenDownAt: true } });
        if (!photo) throw new NotFoundError("Photo not found.");
        if (photo.takenDownAt) throw new ConflictError("ALREADY_TAKEN_DOWN", "This photo is already down.");
        await db.schoolWebsitePhoto.update({
          where: { id: input.photoId },
          data: { takenDownAt: now, takenDownBy: adminCtx.userId, takeDownReason: input.reason },
        });
      } else {
        const post = await db.schoolWebsitePost.findUnique({ where: { id: input.postId! }, select: { takenDownAt: true } });
        if (!post) throw new NotFoundError("Post not found.");
        if (post.takenDownAt) throw new ConflictError("ALREADY_TAKEN_DOWN", "This post is already down.");
        await db.schoolWebsitePost.update({
          where: { id: input.postId! },
          data: { takenDownAt: now, takenDownBy: adminCtx.userId, takeDownReason: input.reason },
        });
      }
      // Every open report about it is answered by the take-down.
      const resolved = await db.schoolWebsiteReport.updateMany({
        where: { resolvedAt: null, ...(input.photoId ? { photoId: input.photoId } : { postId: input.postId! }) },
        data: { resolvedAt: now, resolvedBy: adminCtx.userId, resolution: "TAKEN_DOWN" },
      });
      if (resolved.count > 0) await this.syncOpenCount(db, schoolId);
    });
    await this.audit(adminCtx, AUDIT.takeDown, schoolId, reqCtx, {
      photoId: input.photoId ?? null,
      postId: input.postId ?? null,
      reason: input.reason,
    });
  }

  async dismissReport(schoolId: string, reportId: string, adminCtx: PlatformAdminContext, reqCtx: RequestContext): Promise<void> {
    await this.assertSchool(schoolId);
    await withTenant(schoolId, async (db) => {
      const report = await db.schoolWebsiteReport.findUnique({ where: { id: reportId }, select: { resolvedAt: true } });
      if (!report) throw new NotFoundError("Report not found.");
      if (report.resolvedAt) return;
      await db.schoolWebsiteReport.update({
        where: { id: reportId },
        data: { resolvedAt: new Date(), resolvedBy: adminCtx.userId, resolution: "DISMISSED" },
      });
      await this.syncOpenCount(db, schoolId);
    });
    await this.audit(adminCtx, AUDIT.dismiss, schoolId, reqCtx, { reportId });
  }

  /** Recounted rather than decremented, so it can never drift below the truth. */
  private async syncOpenCount(db: TenantDb, schoolId: string): Promise<void> {
    const open = await db.schoolWebsiteReport.count({ where: { resolvedAt: null } });
    await db.school.update({ where: { id: schoolId }, data: { websiteOpenReports: open } });
  }

  private async assertSchool(schoolId: string): Promise<void> {
    const school = await basePrisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) throw new NotFoundError("School not found.");
  }

  private async audit(adminCtx: PlatformAdminContext, action: string, schoolId: string, reqCtx: RequestContext, metadata: Record<string, unknown>): Promise<void> {
    await basePrisma.auditLog.create({
      data: { schoolId: null, userId: adminCtx.userId, action, entityType: "school", entityId: schoolId, ipAddress: reqCtx.ipAddress, metadata: metadata as object },
    });
  }
}
