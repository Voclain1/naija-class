import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  PHOTO_MAX_BYTES,
  ValidationError,
  photoUrlsSchema,
  type PhotoStatusDto,
  type PhotoUrlsDto,
  type PhotoUrlsInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { UploadErrorFilter } from "../../common/upload-error.filter.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { PhotosService } from "./photos.service.js";

// Passport photos (2026-10-19, docs/modules/id-cards-and-store.md §2).
// multipart/form-data with a `file` field holding a JPEG.

function requireFile(file: Express.Multer.File | undefined): Buffer {
  if (!file) {
    throw new ValidationError("INVALID_UPLOAD", "No file uploaded. Use multipart/form-data with a 'file' field.");
  }
  return file.buffer;
}

@Controller("students")
@UseGuards(AuthGuard, PermissionsGuard)
export class StudentPhotosController {
  constructor(private readonly service: PhotosService) {}

  // POST /students/photo-urls — signed links for up to 200 students at once.
  @Post("photo-urls")
  @HttpCode(200)
  @Permissions("student.read")
  async urls(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(photoUrlsSchema)) body: PhotoUrlsInput,
  ): Promise<PhotoUrlsDto> {
    return this.service.studentPhotoUrls(authCtx, body.ids);
  }

  @Post(":id/photo")
  @HttpCode(200)
  @Permissions("student.update")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PHOTO_MAX_BYTES } }))
  @UseFilters(new UploadErrorFilter("5 MB"))
  async upload(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
  ): Promise<PhotoStatusDto> {
    return this.service.setStudentPhoto(authCtx, id, requireFile(file), { ipAddress: ip });
  }

  @Delete(":id/photo")
  @Permissions("student.update")
  async remove(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<PhotoStatusDto> {
    return this.service.removeStudentPhoto(authCtx, id, { ipAddress: ip });
  }
}

// Staff photos: no PermissionsGuard, because a person may always change and
// see their own; the service checks user.update / user.read for anyone else.
@Controller("users")
@UseGuards(AuthGuard)
export class StaffPhotosController {
  constructor(private readonly service: PhotosService) {}

  // POST /users/photo-urls — anyone's with user.read, otherwise only your own.
  @Post("photo-urls")
  @HttpCode(200)
  async urls(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(photoUrlsSchema)) body: PhotoUrlsInput,
  ): Promise<PhotoUrlsDto> {
    return this.service.staffPhotoUrls(authCtx, body.ids);
  }

  @Post("me/photo")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PHOTO_MAX_BYTES } }))
  @UseFilters(new UploadErrorFilter("5 MB"))
  async uploadOwn(
    @CurrentUser() authCtx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
  ): Promise<PhotoStatusDto> {
    return this.service.setStaffPhoto(authCtx, authCtx.userId, requireFile(file), { ipAddress: ip });
  }

  @Delete("me/photo")
  async removeOwn(@CurrentUser() authCtx: AuthContext, @Ip() ip: string): Promise<PhotoStatusDto> {
    return this.service.removeStaffPhoto(authCtx, authCtx.userId, { ipAddress: ip });
  }

  @Post(":id/photo")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PHOTO_MAX_BYTES } }))
  @UseFilters(new UploadErrorFilter("5 MB"))
  async upload(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
  ): Promise<PhotoStatusDto> {
    return this.service.setStaffPhoto(authCtx, id, requireFile(file), { ipAddress: ip });
  }

  @Delete(":id/photo")
  async remove(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<PhotoStatusDto> {
    return this.service.removeStaffPhoto(authCtx, id, { ipAddress: ip });
  }
}
