import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  SCAN_MAX_FILE_SIZE_BYTES,
  commitScanSchema,
  type CommitScanInput,
  type ScanExtractionResponse,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { UploadErrorFilter } from "../../common/upload-error.filter";
import { StudentScanService } from "./student-scan.service";

// Smart Student Import — camera-captured student registers.
// docs/modules/smart-student-import.md.
//
// TWO PERMISSIONS, and they are deliberately not the same one:
//
//   * `student.scan` gates extraction — the action that SPENDS the school's
//     monthly AI budget.
//   * `student.import` gates the commit — the action that WRITES permanent
//     student records. Reused rather than minted fresh, because committing a
//     scan IS a student import: same worker, same validation, same audit
//     trail. A separate `student.scan.commit` would be a second permission a
//     school could set inconsistently for one indivisible outcome.
//
// This mirrors the `report-card-comment.generate` / `.write` split, which
// exists for the same reason: spending budget and writing a permanent record
// are different stakes.
@Controller("student-scan")
@UseGuards(AuthGuard, PermissionsGuard)
export class StudentScanController {
  constructor(private readonly service: StudentScanService) {}

  // GET /student-scan/availability
  //
  // Lets the UI hide the camera affordance when AI is off for this school or
  // this deployment, rather than letting an admin photograph a register and
  // only then meet an error. Gated on `student.scan` like the extraction it
  // describes — someone who cannot scan has no use for its availability.
  @Get("availability")
  @Permissions("student.scan")
  availability(): { available: boolean } {
    return { available: this.service.isConfigured() };
  }

  // POST /student-scan — multipart/form-data with an `image` field.
  //
  // Multer's memoryStorage (the default when FileInterceptor is given no
  // destination) is LOAD-BEARING here, not incidental: D3 requires the image
  // never to touch a disk. A `dest` option on this interceptor would write
  // every photographed register to the container filesystem and silently
  // undo the feature's central privacy decision. Do not add one.
  //
  // `limits.fileSize` makes Multer abort the read mid-stream once the cap is
  // exceeded, which is the only way to enforce it WITHOUT first buffering the
  // whole file. UploadErrorFilter converts the resulting exception into the
  // standard error envelope.
  //
  // No @HttpCode: extraction creates an ImportJob, so 201 is correct.
  @Post()
  @Permissions("student.scan")
  @UseFilters(UploadErrorFilter)
  @UseInterceptors(
    FileInterceptor("image", { limits: { fileSize: SCAN_MAX_FILE_SIZE_BYTES } }),
  )
  async scan(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ScanExtractionResponse> {
    return this.service.extractFromImage(authCtx, file, {
      ipAddress: ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
  }

  // POST /student-scan/:jobId/commit — D4's human gate.
  //
  // The body carries the rows the ADMIN confirmed. Nothing from the
  // extraction is trusted here beyond the job's identity; every field is
  // re-validated server-side against the same schema the CSV path uses.
  @Post(":jobId/commit")
  @Permissions("student.import")
  async commit(
    @Param("jobId", ParseUUIDPipe) jobId: string,
    @Body(new ZodValidationPipe(commitScanSchema)) dto: CommitScanInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    return this.service.commitScan(authCtx, jobId, dto, {
      ipAddress: ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
  }
}
