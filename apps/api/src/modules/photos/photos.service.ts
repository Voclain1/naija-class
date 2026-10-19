import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ForbiddenError,
  NotFoundError,
  PHOTO_MAX_BYTES,
  ValidationError,
  type PhotoStatusDto,
  type PhotoUrlsDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { getActiveUserRoleKeys, userHoldsPermission } from "../../common/auth/role-check.js";
import { sniffPrivateFile } from "../../common/storage/private-file.js";
import { StorageService } from "../../common/storage/storage.service.js";

// Passport photos for students and staff (2026-10-19,
// docs/modules/id-cards-and-store.md §2).
//
// One private JPEG per person, overwritten in place; `photo_uploaded_at`
// says whether there is one. Read through short-lived signed links, asked for
// in batches so a roster of 50 children costs one request. Every upload and
// removal is audited.
//
// Who may: a student's photo needs student.update to change and student.read
// to see (the controller's PermissionsGuard). A staff photo may be changed by
// the person themselves or by someone holding user.update, and seen by the
// person themselves or by someone holding user.read.

export const PHOTO_URL_TTL_SECONDS = 60 * 60;

interface RequestContext {
  ipAddress: string | null;
}

/** Throws unless the bytes are a JPEG of an allowed size. */
export function assertPhotoJpeg(buffer: Buffer): void {
  if (buffer.length === 0) throw new ValidationError("INVALID_UPLOAD", "The file is empty.");
  if (buffer.length > PHOTO_MAX_BYTES) {
    throw new ValidationError("FILE_TOO_LARGE", "The photo is larger than 5 MB.");
  }
  if (sniffPrivateFile(buffer)?.ext !== "jpg") {
    throw new ValidationError("INVALID_FILE_TYPE", "Upload the photo as a JPEG.");
  }
}

// The second gate behind the controller's PermissionsGuard (the codebase's
// two-gate convention), and the active-account check every write makes.
async function assertHolds(authCtx: AuthContext, permission: string): Promise<void> {
  await getActiveUserRoleKeys(authCtx);
  if (!(await userHoldsPermission(authCtx, permission))) {
    throw new ForbiddenError("You do not have permission to do that.");
  }
}

@Injectable()
export class PhotosService {
  constructor(private readonly storage: StorageService) {}

  // ---------------------------------------------------------------- students

  async setStudentPhoto(
    authCtx: AuthContext,
    studentId: string,
    buffer: Buffer,
    reqCtx: RequestContext,
  ): Promise<PhotoStatusDto> {
    await assertHolds(authCtx, "student.update");
    assertPhotoJpeg(buffer);
    return withTenant(authCtx.schoolId, async (db) => {
      const student = await db.student.findUnique({ where: { id: studentId }, select: { id: true } });
      if (!student) throw new NotFoundError("Student not found.");
      await this.storage.put(authCtx.schoolId, { kind: "student-photo", studentId }, buffer, "image/jpeg");
      const row = await db.student.update({
        where: { id: studentId },
        data: { photoUploadedAt: new Date() },
        select: { photoUploadedAt: true },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "student.photo.set",
          entityType: "student",
          entityId: studentId,
          ipAddress: reqCtx.ipAddress,
          metadata: { size: buffer.length },
        },
      });
      return { hasPhoto: true, photoUploadedAt: row.photoUploadedAt };
    });
  }

  async removeStudentPhoto(authCtx: AuthContext, studentId: string, reqCtx: RequestContext): Promise<PhotoStatusDto> {
    await assertHolds(authCtx, "student.update");
    return withTenant(authCtx.schoolId, async (db) => {
      const student = await db.student.findUnique({
        where: { id: studentId },
        select: { photoUploadedAt: true },
      });
      if (!student) throw new NotFoundError("Student not found.");
      if (student.photoUploadedAt === null) return { hasPhoto: false, photoUploadedAt: null };
      await this.storage.delete(authCtx.schoolId, { kind: "student-photo", studentId });
      await db.student.update({ where: { id: studentId }, data: { photoUploadedAt: null } });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "student.photo.remove",
          entityType: "student",
          entityId: studentId,
          ipAddress: reqCtx.ipAddress,
        },
      });
      return { hasPhoto: false, photoUploadedAt: null };
    });
  }

  async studentPhotoUrls(authCtx: AuthContext, ids: string[]): Promise<PhotoUrlsDto> {
    await assertHolds(authCtx, "student.read");
    const rows = await withTenant(authCtx.schoolId, (db) =>
      db.student.findMany({
        where: { id: { in: ids }, photoUploadedAt: { not: null } },
        select: { id: true },
      }),
    );
    const urls: Record<string, string> = {};
    for (const row of rows) {
      const url = await this.storage.signUrl(
        authCtx.schoolId,
        { kind: "student-photo", studentId: row.id },
        PHOTO_URL_TTL_SECONDS,
      );
      urls[row.id] = url;
    }
    return { urls };
  }

  // ------------------------------------------------------------------- staff

  async setStaffPhoto(
    authCtx: AuthContext,
    userId: string,
    buffer: Buffer,
    reqCtx: RequestContext,
  ): Promise<PhotoStatusDto> {
    await this.assertMayChangeStaffPhoto(authCtx, userId);
    assertPhotoJpeg(buffer);
    return withTenant(authCtx.schoolId, async (db) => {
      const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) throw new NotFoundError("Staff member not found.");
      await this.storage.put(authCtx.schoolId, { kind: "staff-photo", userId }, buffer, "image/jpeg");
      const row = await db.user.update({
        where: { id: userId },
        data: { photoUploadedAt: new Date() },
        select: { photoUploadedAt: true },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "staff.photo.set",
          entityType: "user",
          entityId: userId,
          ipAddress: reqCtx.ipAddress,
          metadata: { size: buffer.length, own: userId === authCtx.userId },
        },
      });
      return { hasPhoto: true, photoUploadedAt: row.photoUploadedAt };
    });
  }

  async removeStaffPhoto(authCtx: AuthContext, userId: string, reqCtx: RequestContext): Promise<PhotoStatusDto> {
    await this.assertMayChangeStaffPhoto(authCtx, userId);
    return withTenant(authCtx.schoolId, async (db) => {
      const user = await db.user.findUnique({ where: { id: userId }, select: { photoUploadedAt: true } });
      if (!user) throw new NotFoundError("Staff member not found.");
      if (user.photoUploadedAt === null) return { hasPhoto: false, photoUploadedAt: null };
      await this.storage.delete(authCtx.schoolId, { kind: "staff-photo", userId });
      await db.user.update({ where: { id: userId }, data: { photoUploadedAt: null } });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "staff.photo.remove",
          entityType: "user",
          entityId: userId,
          ipAddress: reqCtx.ipAddress,
          metadata: { own: userId === authCtx.userId },
        },
      });
      return { hasPhoto: false, photoUploadedAt: null };
    });
  }

  /** Signed links for staff photos: anyone's with user.read, otherwise only your own. */
  async staffPhotoUrls(authCtx: AuthContext, ids: string[]): Promise<PhotoUrlsDto> {
    await getActiveUserRoleKeys(authCtx);
    const allowed = (await userHoldsPermission(authCtx, "user.read"))
      ? ids
      : ids.filter((id) => id === authCtx.userId);
    if (allowed.length === 0) return { urls: {} };
    const rows = await withTenant(authCtx.schoolId, (db) =>
      db.user.findMany({
        where: { id: { in: allowed }, photoUploadedAt: { not: null } },
        select: { id: true },
      }),
    );
    const urls: Record<string, string> = {};
    for (const row of rows) {
      const url = await this.storage.signUrl(
        authCtx.schoolId,
        { kind: "staff-photo", userId: row.id },
        PHOTO_URL_TTL_SECONDS,
      );
      urls[row.id] = url;
    }
    return { urls };
  }

  private async assertMayChangeStaffPhoto(authCtx: AuthContext, userId: string): Promise<void> {
    await getActiveUserRoleKeys(authCtx);
    if (userId === authCtx.userId) return;
    if (!(await userHoldsPermission(authCtx, "user.update"))) {
      throw new ForbiddenError("You can change only your own photo.");
    }
  }
}

