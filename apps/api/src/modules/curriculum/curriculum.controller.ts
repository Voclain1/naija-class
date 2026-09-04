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
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import {
  ValidationError,
  listCurriculumDocumentsQuerySchema,
  pasteCurriculumDocumentSchema,
  updateCurriculumChunkSchema,
  uploadCurriculumDocumentSchema,
  type ApproveCurriculumDocumentResponse,
  type CurriculumDocumentDetailResponse,
  type CurriculumDocumentListResponse,
  type CurriculumUploadAcceptedResponse,
  type PasteCurriculumDocumentInput,
  type UpdateCurriculumChunkInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { UploadErrorFilter } from "../../common/upload-error.filter";
import { CURRICULUM_MAX_FILE_SIZE_BYTES } from "./curriculum.constants";
import { CurriculumService } from "./curriculum.service";

// Authz: AuthGuard + PermissionsGuard, with `curriculum.delete` deliberately
// narrower than `curriculum.upload` — see PHASE_7_PERMISSIONS for why deleting
// has the wider blast radius despite looking like the smaller action.
@Controller("curriculum/documents")
@UseGuards(AuthGuard, PermissionsGuard)
export class CurriculumController {
  constructor(private readonly service: CurriculumService) {}

  // POST /curriculum/documents/upload — multipart/form-data.
  //
  // Multer's limits.fileSize aborts the read mid-stream once the cap is
  // exceeded, which is the only way to enforce it without first buffering the
  // whole file; UploadErrorFilter converts the resulting exception into this
  // codebase's FILE_TOO_LARGE envelope. Same shape as the CSV importer.
  @Post("upload")
  @HttpCode(202)
  @Permissions("curriculum.upload")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: CURRICULUM_MAX_FILE_SIZE_BYTES } }),
  )
  @UseFilters(new UploadErrorFilter("10 MB"))
  async upload(
    @CurrentUser() authCtx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ): Promise<CurriculumUploadAcceptedResponse> {
    if (!file) {
      throw new ValidationError(
        "INVALID_UPLOAD",
        "No file uploaded. Use multipart/form-data with a 'file' field.",
      );
    }
    // Multipart fields arrive as strings and bypass the global ZodValidationPipe
    // (which sees the raw body), so the schema is applied explicitly here.
    const input = uploadCurriculumDocumentSchema.parse(body);
    return this.service.uploadFile(authCtx, input, {
      buffer: file.buffer,
      originalname: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    });
  }

  // POST /curriculum/documents/paste — the D6 escape hatch.
  //
  // A first-class endpoint rather than an optional field on the upload above.
  // The plan calls the paste box "the escape hatch that keeps the slice
  // shippable when a file will not parse", and a route of its own is what makes
  // that a supported path rather than a fallback nobody maintains.
  @Post("paste")
  @HttpCode(202)
  @Permissions("curriculum.upload")
  async paste(
    @CurrentUser() authCtx: AuthContext,
    @Body() body: PasteCurriculumDocumentInput,
  ): Promise<CurriculumUploadAcceptedResponse> {
    const input = pasteCurriculumDocumentSchema.parse(body);
    return this.service.uploadPastedText(authCtx, input);
  }

  @Get()
  @Permissions("curriculum.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query() query: unknown,
  ): Promise<CurriculumDocumentListResponse> {
    return this.service.list(authCtx, listCurriculumDocumentsQuerySchema.parse(query ?? {}));
  }

  @Get(":documentId")
  @Permissions("curriculum.read")
  async getOne(
    @CurrentUser() authCtx: AuthContext,
    @Param("documentId", ParseUUIDPipe) documentId: string,
  ): Promise<CurriculumDocumentDetailResponse> {
    return this.service.getOne(authCtx, documentId);
  }

  // -------------------------------------------------------------------------
  // CP5 — the review gate (D28-D35).
  //
  // All three carry `curriculum.upload`, NOT a new `curriculum.review`
  // permission (D33). Approving is not a distinct authority from uploading —
  // someone trusted to add curriculum is trusted to confirm it parsed
  // correctly — and a new permission would mean a migration and a role-grant
  // backfill for no access-control gain. The substantive check (this row is
  // yours, and it is still IN review) lives in the service, exactly as the
  // ownership-scoped delete below does.
  //
  // There is no GET for review: the existing GET :documentId already returns
  // the document with its chunks in ordinal order, which is precisely the
  // review payload. Adding a second read of the same rows under a different
  // name would be duplication, not clarity.
  // -------------------------------------------------------------------------

  // PATCH /curriculum/documents/:documentId/chunks/:chunkId — correct a heading.
  //
  // Applied immediately rather than accumulated and saved on approval, so an
  // interrupted review loses nothing and the edit counter (D31) records real
  // corrections as they happen.
  @Patch(":documentId/chunks/:chunkId")
  @Permissions("curriculum.upload")
  async updateChunk(
    @CurrentUser() authCtx: AuthContext,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Param("chunkId", ParseUUIDPipe) chunkId: string,
    @Body() body: UpdateCurriculumChunkInput,
  ): Promise<CurriculumDocumentDetailResponse> {
    const input = updateCurriculumChunkSchema.parse(body);
    return this.service.updateChunk(authCtx, documentId, chunkId, input);
  }

  // DELETE /curriculum/documents/:documentId/chunks/:chunkId — drop a section
  // the parser should not have produced (front matter, contents page).
  //
  // Returns 200 with the refreshed document rather than 204, unlike the
  // document delete below: the caller is a review screen that must immediately
  // re-render the remaining sections, and handing it the new state saves a
  // follow-up round trip on every click.
  @Delete(":documentId/chunks/:chunkId")
  @Permissions("curriculum.upload")
  async discardChunk(
    @CurrentUser() authCtx: AuthContext,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Param("chunkId", ParseUUIDPipe) chunkId: string,
  ): Promise<CurriculumDocumentDetailResponse> {
    return this.service.discardChunk(authCtx, documentId, chunkId);
  }

  // POST /curriculum/documents/:documentId/approve — the gate itself.
  //
  // 202, not 200: approval moves the document to EMBEDDING and queues the
  // vendor work. The teacher polls from here exactly as they did for ingestion
  // before CP5 — the difference is that the wait now happens AFTER a human has
  // confirmed the structure, not before anyone has seen it.
  @Post(":documentId/approve")
  @HttpCode(202)
  @Permissions("curriculum.upload")
  async approve(
    @CurrentUser() authCtx: AuthContext,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Ip() ip: string,
  ): Promise<ApproveCurriculumDocumentResponse> {
    return this.service.approve(authCtx, documentId, ip);
  }

  @Delete(":documentId")
  @HttpCode(204)
  @Permissions("curriculum.delete")
  async remove(
    @CurrentUser() authCtx: AuthContext,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.remove(authCtx, documentId, ip);
  }
}
