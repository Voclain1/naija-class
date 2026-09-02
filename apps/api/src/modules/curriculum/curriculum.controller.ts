import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
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
  uploadCurriculumDocumentSchema,
  type CurriculumDocumentDetailResponse,
  type CurriculumDocumentListResponse,
  type CurriculumUploadAcceptedResponse,
  type PasteCurriculumDocumentInput,
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
