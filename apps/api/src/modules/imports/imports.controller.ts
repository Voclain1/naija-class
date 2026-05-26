import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ValidationError,
  type ImportJobDto,
  type ImportMappingAcceptedResponse,
  type ImportUploadResponse,
} from "@school-kit/types";
import type { Request, Response } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { CSV_MAX_FILE_SIZE_BYTES } from "./imports.csv-parser";
import { ImportsService } from "./imports.service";

// Multer rejects oversized uploads via PayloadTooLargeException (NestJS
// translates Multer's LIMIT_FILE_SIZE into that exception in
// platform-express's `transformException`). The global HttpExceptionFilter
// would render the default 413 envelope, but the spec demands the
// `FILE_TOO_LARGE` sub-code so the wizard can branch without parsing the
// message. This controller-scoped filter intercepts the 413 and writes the
// canonical envelope. Scoped (not global) because no other endpoint
// produces a 413, and a global mapping would couple unrelated routes to
// the same code.
@Catch(PayloadTooLargeException, BadRequestException)
class UploadMulterErrorFilter implements ExceptionFilter {
  catch(
    exception: PayloadTooLargeException | BadRequestException,
    host: ArgumentsHost,
  ): void {
    const res = host.switchToHttp().getResponse<Response>();
    // BadRequestException can land here when Multer rejects on something
    // other than size (e.g. malformed multipart). Surface a generic
    // INVALID_UPLOAD code so the client never sees a stray 400 with the
    // wrong shape. We keep multer's own message because it's normally
    // useful debugging info (e.g. "Unexpected field").
    if (exception instanceof BadRequestException) {
      res.status(400).json({
        error: {
          code: "INVALID_UPLOAD",
          message: exception.message || "The uploaded file could not be read.",
        },
      });
      return;
    }
    res.status(413).json({
      error: {
        code: "FILE_TOO_LARGE",
        message:
          "This file is larger than the 5 MB limit. Please split it into smaller files and upload them separately.",
      },
    });
  }
}

// PermissionsGuard is slice 13; until then AuthGuard + service-level
// assertUserActiveAndHasOneOf("owner"/"admin") is the authz pattern (same
// shape as every Phase 1 slice). `student.import` was added to the
// reference permission list in this slice but is not yet enforced — slice
// 13 will sweep all reference permissions into the guard.
@Controller("imports")
@UseGuards(AuthGuard)
export class ImportsController {
  constructor(private readonly service: ImportsService) {}

  // POST /imports/students/upload — multipart/form-data with `file` field.
  //
  // Multer is configured with `memoryStorage` (the default for
  // FileInterceptor when no destination is provided) so the buffer is
  // already in memory by the time the handler runs. The `limits.fileSize`
  // cap means Multer aborts the read mid-stream once the threshold is
  // exceeded — that's the only way to enforce the cap WITHOUT first
  // buffering the entire file. The PayloadTooLargeException filter above
  // converts the resulting HTTP exception to our FILE_TOO_LARGE envelope.
  @Post("students/upload")
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: CSV_MAX_FILE_SIZE_BYTES },
    }),
  )
  @UseFilters(UploadMulterErrorFilter)
  async uploadStudents(
    @CurrentUser() authCtx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ImportUploadResponse> {
    if (!file) {
      // FileInterceptor calls the handler even when no `file` field was
      // present in the multipart body — we have to detect that here.
      // Throwing a ValidationError lands in the global HttpExceptionFilter
      // (not the controller-scoped filter above, since ValidationError
      // isn't a NestJS HttpException) and emits the standard 400 envelope.
      throw new ValidationError(
        "INVALID_UPLOAD",
        "No file uploaded. Use multipart/form-data with a 'file' field.",
      );
    }
    return this.service.uploadStudents(
      authCtx,
      {
        buffer: file.buffer,
        originalname: file.originalname,
        size: file.size,
      },
      {
        ipAddress: ip,
        userAgent: req.header("user-agent") ?? null,
      },
    );
  }

  // POST /imports/:jobId/mapping — JSON body
  // Pipe-validated jobId rejects non-UUID early (404 if the row truly
  // doesn't exist is handled in the service; non-UUIDs never need a DB
  // round-trip).
  @Post(":jobId/mapping")
  @HttpCode(202)
  async applyMapping(
    @CurrentUser() authCtx: AuthContext,
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Body() body: unknown,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ImportMappingAcceptedResponse> {
    return this.service.applyMapping(authCtx, jobId, body, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Get(":jobId")
  async getJob(
    @CurrentUser() authCtx: AuthContext,
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
  ): Promise<ImportJobDto> {
    return this.service.getJob(authCtx, jobId);
  }

  @Delete(":jobId")
  @HttpCode(204)
  async deleteJob(
    @CurrentUser() authCtx: AuthContext,
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.deleteJob(authCtx, jobId, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
