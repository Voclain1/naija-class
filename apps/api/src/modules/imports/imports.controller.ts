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
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ValidationError,
  type ImportCommitAcceptedResponse,
  type ImportJobDto,
  type ImportMappingAcceptedResponse,
  type ImportUploadResponse,
} from "@school-kit/types";
import type { Request, Response } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
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

// Authz: AuthGuard + PermissionsGuard (slice 13). The per-type UPLOAD
// endpoints gate on the matching {student,guardian,teacher}.import permission.
// The SHARED lifecycle endpoints (mapping / commit / getJob / delete /
// downloads) serve all three import types — the type is only known at runtime
// from the ImportJob row, so they gate on `student.import` as the
// representative import permission (admin co-holds all three import perms;
// owner has the wildcard; teacher has none — so no role can reach a shared
// endpoint without also holding the type-specific upload permission). The
// service-layer assertUserActiveAndHasOneOf("owner"/"admin") stays as the
// substantive defense-in-depth gate.
@Controller("imports")
@UseGuards(AuthGuard, PermissionsGuard)
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
  @Permissions("student.import")
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

  // POST /imports/guardians/upload — slice 8. Symmetric with the students
  // upload (same multipart shape, same multer cap, same error filter).
  // The service dispatches the type-aware ImportJob creation; the upload
  // path is otherwise identical.
  @Post("guardians/upload")
  @HttpCode(201)
  @Permissions("guardian.import")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: CSV_MAX_FILE_SIZE_BYTES },
    }),
  )
  @UseFilters(UploadMulterErrorFilter)
  async uploadGuardians(
    @CurrentUser() authCtx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ImportUploadResponse> {
    if (!file) {
      throw new ValidationError(
        "INVALID_UPLOAD",
        "No file uploaded. Use multipart/form-data with a 'file' field.",
      );
    }
    return this.service.uploadGuardians(
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

  // POST /imports/teachers/upload — slice 10 cp2. Symmetric with students /
  // guardians upload. Invite-only teacher CSV (email + firstName +
  // lastName); each good row becomes one Invitation at commit.
  @Post("teachers/upload")
  @HttpCode(201)
  @Permissions("teacher.import")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: CSV_MAX_FILE_SIZE_BYTES },
    }),
  )
  @UseFilters(UploadMulterErrorFilter)
  async uploadTeachers(
    @CurrentUser() authCtx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ImportUploadResponse> {
    if (!file) {
      throw new ValidationError(
        "INVALID_UPLOAD",
        "No file uploaded. Use multipart/form-data with a 'file' field.",
      );
    }
    return this.service.uploadTeachers(
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
  @Permissions("student.import")
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

  // GET /imports/:jobId/bad-rows.csv — re-streams source.csv, re-runs the
  // engine, emits a CSV with the original headers + a final `_errors`
  // column. Tenant-scoped via AuthGuard + service role check; an audit
  // row lands BEFORE the response is sent (NDPR — PII export). We use
  // @Res() to write the streaming body and headers directly; throws
  // BEFORE res.send() still route through the global HttpExceptionFilter
  // because no response has been sent yet.
  @Get(":jobId/bad-rows.csv")
  @Permissions("student.import")
  async downloadBadRowsCsv(
    @CurrentUser() authCtx: AuthContext,
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Ip() ip: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, content } = await this.service.generateBadRowsCsv(
      authCtx,
      jobId,
      {
        ipAddress: ip,
        userAgent: req.header("user-agent") ?? null,
      },
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.send(content);
  }

  // POST /imports/:jobId/commit — flips READY → COMMITTING, enqueues the
  // commit worker, returns 202. The wizard polls GET /imports/:jobId for
  // status === COMPLETED / FAILED. Same async-202 shape as POST /mapping.
  @Post(":jobId/commit")
  @HttpCode(202)
  @Permissions("student.import")
  async commit(
    @CurrentUser() authCtx: AuthContext,
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ImportCommitAcceptedResponse> {
    return this.service.triggerCommit(authCtx, jobId, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // GET /imports/:jobId/error-report.csv — serves the persisted error
  // report from storage. Audit row before bytes (NDPR — PII export).
  // 409 if the job isn't COMPLETED, or if it completed with no errors
  // (NO_ERROR_REPORT), or if the file is gone from storage
  // (ERROR_REPORT_MISSING).
  @Get(":jobId/error-report.csv")
  @Permissions("student.import")
  async downloadErrorReportCsv(
    @CurrentUser() authCtx: AuthContext,
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Ip() ip: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, content } = await this.service.generateErrorReportCsv(
      authCtx,
      jobId,
      {
        ipAddress: ip,
        userAgent: req.header("user-agent") ?? null,
      },
    );
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.send(content);
  }

  @Get(":jobId")
  @Permissions("student.import")
  async getJob(
    @CurrentUser() authCtx: AuthContext,
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
  ): Promise<ImportJobDto> {
    return this.service.getJob(authCtx, jobId);
  }

  @Delete(":jobId")
  @HttpCode(204)
  @Permissions("student.import")
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
