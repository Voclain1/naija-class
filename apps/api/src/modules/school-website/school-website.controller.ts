import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import {
  ValidationError,
  WEBSITE_LIMITS,
  WEBSITE_PHOTO_KINDS,
  updateWebsitePhotoSchema,
  updateWebsitePostSchema,
  uploadWebsitePhotoSchema,
  websiteAlbumSchema,
  websiteDetailsSchema,
  websitePostSchema,
  websiteReportSchema,
  websiteTakeDownSchema,
  type PlatformWebsiteReportQueueDto,
  type PlatformWebsiteReviewDto,
  type PublicWebsiteGalleryDto,
  type SchoolSitemapDto,
  type PublicWebsiteNewsDto,
  type PublicWebsitePostDto,
  type SchoolWebsiteDto,
  type UpdateWebsitePhotoInput,
  type UpdateWebsitePostInput,
  type UploadWebsitePhotoInput,
  type WebsiteAlbumDto,
  type WebsiteAlbumInput,
  type WebsiteDetailsInput,
  type WebsitePhotoDto,
  type WebsitePhotoKind,
  type WebsitePhotoListDto,
  type WebsitePostDto,
  type WebsitePostInput,
  type WebsitePreviewDto,
  type WebsiteReportInput,
  type WebsiteTakeDownInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentPlatformAdmin } from "../../common/auth/current-platform-admin.decorator.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import type { PlatformAdminContext } from "../../common/auth/platform-admin-context.js";
import { PlatformAdminGuard } from "../../common/auth/platform-admin.guard.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { UploadErrorFilter } from "../../common/upload-error.filter.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SchoolWebsitePlatformService } from "./school-website-platform.service.js";
import { SchoolWebsitePublicService } from "./school-website-public.service.js";
import { SchoolWebsiteService } from "./school-website.service.js";

// The school's public website (2026-10-22, docs/modules/school-website.md).
// Three controllers, one per principal: the school's staff (website.manage),
// the public, and SchoolKit's operator.

type UploadedParts = { file?: Express.Multer.File[]; thumb?: Express.Multer.File[] };

@Controller("school-website")
@UseGuards(AuthGuard, PermissionsGuard)
export class SchoolWebsiteController {
  constructor(private readonly service: SchoolWebsiteService) {}

  @Get()
  @Permissions("website.manage")
  get(@CurrentUser() authCtx: AuthContext): Promise<SchoolWebsiteDto> {
    return this.service.get(authCtx);
  }

  @Put("draft")
  @Permissions("website.manage")
  saveDraft(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(websiteDetailsSchema)) body: WebsiteDetailsInput,
    @Ip() ip: string,
  ): Promise<SchoolWebsiteDto> {
    return this.service.saveDraft(authCtx, body, { ipAddress: ip });
  }

  @Post("publish")
  @HttpCode(200)
  @Permissions("website.manage")
  publish(@CurrentUser() authCtx: AuthContext, @Ip() ip: string): Promise<SchoolWebsiteDto> {
    return this.service.publish(authCtx, { ipAddress: ip });
  }

  @Post("preview")
  @HttpCode(200)
  @Permissions("website.manage")
  preview(@CurrentUser() authCtx: AuthContext): Promise<WebsitePreviewDto> {
    return this.service.preview(authCtx);
  }

  // ── photos

  @Get("photos")
  @Permissions("website.manage")
  photos(@CurrentUser() authCtx: AuthContext, @Query("kind") kind: string | undefined): Promise<WebsitePhotoListDto> {
    const k = kind && (WEBSITE_PHOTO_KINDS as readonly string[]).includes(kind) ? (kind as WebsitePhotoKind) : undefined;
    return this.service.listPhotos(authCtx, k);
  }

  // multipart/form-data: `file` (the large JPEG), `thumb` (the small one),
  // and the fields of uploadWebsitePhotoSchema, including noPupils=true. The
  // staff app sends the small one as the `thumbBase64` field instead.
  @Post("photos")
  @Permissions("website.manage")
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "file", maxCount: 1 },
        { name: "thumb", maxCount: 1 },
      ],
      // fieldSize: room for `thumbBase64` (512 KB as base64 is about 700 KB).
      { limits: { fileSize: WEBSITE_LIMITS.photoBytes, files: 2, fieldSize: 1024 * 1024 } },
    ),
  )
  @UseFilters(new UploadErrorFilter("3 MB"))
  upload(
    @CurrentUser() authCtx: AuthContext,
    @UploadedFiles() parts: UploadedParts | undefined,
    @Body(new ZodValidationPipe(uploadWebsitePhotoSchema)) body: UploadWebsitePhotoInput,
    @Ip() ip: string,
  ): Promise<WebsitePhotoDto> {
    const { thumbBase64, ...fields } = body;
    const large = parts?.file?.[0]?.buffer;
    const thumb = parts?.thumb?.[0]?.buffer ?? (thumbBase64 ? Buffer.from(thumbBase64, "base64") : undefined);
    if (!large || !thumb) {
      throw new ValidationError("INVALID_UPLOAD", "Send the photo as multipart/form-data with 'file' and 'thumb'.");
    }
    return this.service.uploadPhoto(authCtx, { large, thumb }, fields, { ipAddress: ip });
  }

  @Patch("photos/:id")
  @Permissions("website.manage")
  updatePhoto(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWebsitePhotoSchema)) body: UpdateWebsitePhotoInput,
    @Ip() ip: string,
  ): Promise<WebsitePhotoDto> {
    return this.service.updatePhoto(authCtx, id, body, { ipAddress: ip });
  }

  @Delete("photos/:id")
  @HttpCode(204)
  @Permissions("website.manage")
  async deletePhoto(@CurrentUser() authCtx: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Ip() ip: string): Promise<void> {
    await this.service.deletePhoto(authCtx, id, { ipAddress: ip });
  }

  // ── albums

  @Post("albums")
  @Permissions("website.manage")
  createAlbum(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(websiteAlbumSchema)) body: WebsiteAlbumInput,
    @Ip() ip: string,
  ): Promise<WebsiteAlbumDto> {
    return this.service.createAlbum(authCtx, body, { ipAddress: ip });
  }

  @Patch("albums/:id")
  @Permissions("website.manage")
  renameAlbum(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(websiteAlbumSchema)) body: WebsiteAlbumInput,
    @Ip() ip: string,
  ): Promise<WebsiteAlbumDto> {
    return this.service.renameAlbum(authCtx, id, body, { ipAddress: ip });
  }

  @Delete("albums/:id")
  @HttpCode(204)
  @Permissions("website.manage")
  async deleteAlbum(@CurrentUser() authCtx: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Ip() ip: string): Promise<void> {
    await this.service.deleteAlbum(authCtx, id, { ipAddress: ip });
  }

  // ── news

  @Get("posts")
  @Permissions("website.manage")
  posts(@CurrentUser() authCtx: AuthContext): Promise<WebsitePostDto[]> {
    return this.service.listPosts(authCtx);
  }

  @Post("posts")
  @Permissions("website.manage")
  createPost(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(websitePostSchema)) body: WebsitePostInput,
    @Ip() ip: string,
  ): Promise<WebsitePostDto> {
    return this.service.createPost(authCtx, body, { ipAddress: ip });
  }

  @Patch("posts/:id")
  @Permissions("website.manage")
  updatePost(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateWebsitePostSchema)) body: UpdateWebsitePostInput,
    @Ip() ip: string,
  ): Promise<WebsitePostDto> {
    return this.service.updatePost(authCtx, id, body, { ipAddress: ip });
  }

  @Post("posts/:id/publish")
  @HttpCode(200)
  @Permissions("website.manage")
  publishPost(@CurrentUser() authCtx: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Ip() ip: string): Promise<WebsitePostDto> {
    return this.service.setPostPublished(authCtx, id, true, { ipAddress: ip });
  }

  @Post("posts/:id/unpublish")
  @HttpCode(200)
  @Permissions("website.manage")
  unpublishPost(@CurrentUser() authCtx: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Ip() ip: string): Promise<WebsitePostDto> {
    return this.service.setPostPublished(authCtx, id, false, { ipAddress: ip });
  }

  @Delete("posts/:id")
  @HttpCode(204)
  @Permissions("website.manage")
  async deletePost(@CurrentUser() authCtx: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Ip() ip: string): Promise<void> {
    await this.service.deletePost(authCtx, id, { ipAddress: ip });
  }
}

// PUBLIC: the school's news, each post, its gallery, and "Report this photo".
// Beside GET /school-addresses/:code (the front page), which is in the
// schools module.
@Controller("school-addresses")
export class SchoolWebsitePublicController {
  constructor(private readonly service: SchoolWebsitePublicService) {}

  @Get(":code/sitemap")
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  sitemap(@Param("code") code: string): Promise<SchoolSitemapDto> {
    return this.service.sitemap(code);
  }

  @Get(":code/news")
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  news(@Param("code") code: string, @Query("page") page: string | undefined): Promise<PublicWebsiteNewsDto> {
    return this.service.news(code, Number(page ?? "1"));
  }

  @Get(":code/news/:postId")
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  post(@Param("code") code: string, @Param("postId", ParseUUIDPipe) postId: string): Promise<PublicWebsitePostDto> {
    return this.service.post(code, postId);
  }

  @Get(":code/gallery")
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  gallery(@Param("code") code: string): Promise<PublicWebsiteGalleryDto> {
    return this.service.gallery(code);
  }

  @Post(":code/reports")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60 * 60_000, limit: 5 } })
  report(
    @Param("code") code: string,
    @Body(new ZodValidationPipe(websiteReportSchema)) body: WebsiteReportInput,
  ): Promise<{ received: true }> {
    return this.service.report(code, body);
  }
}

// SchoolKit's operator: reports from the public pages, and take-downs.
@Controller("platform-admin")
@UseGuards(PlatformAdminGuard)
export class SchoolWebsitePlatformController {
  constructor(private readonly service: SchoolWebsitePlatformService) {}

  @Get("website-reports")
  queue(): Promise<PlatformWebsiteReportQueueDto> {
    return this.service.queue();
  }

  @Get("schools/:schoolId/website")
  review(
    @Param("schoolId", ParseUUIDPipe) schoolId: string,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
  ): Promise<PlatformWebsiteReviewDto> {
    return this.service.review(schoolId, adminCtx, { ipAddress: ip });
  }

  @Post("schools/:schoolId/website/take-down")
  @HttpCode(204)
  async takeDown(
    @Param("schoolId", ParseUUIDPipe) schoolId: string,
    @Body(new ZodValidationPipe(websiteTakeDownSchema)) body: WebsiteTakeDownInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.takeDown(schoolId, body, adminCtx, { ipAddress: ip });
  }

  @Post("schools/:schoolId/website/reports/:reportId/dismiss")
  @HttpCode(204)
  async dismiss(
    @Param("schoolId", ParseUUIDPipe) schoolId: string,
    @Param("reportId", ParseUUIDPipe) reportId: string,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.dismissReport(schoolId, reportId, adminCtx, { ipAddress: ip });
  }
}
