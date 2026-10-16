import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Put,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import {
  collectWorkSchema,
  markSubmissionSchema,
  returnSubmissionSchema,
  setAssignmentQuestionsSchema,
  submitWorkSchema,
  ValidationError,
  type AssignmentFileUrlDto,
  type AssignmentMarkingDto,
  type BankQuestionListResponse,
  type CollectWorkInput,
  type SetAssignmentQuestionsInput,
  type FamilyAssignmentListResponse,
  type MarkSubmissionInput,
  type MyAssignmentDto,
  type ReturnSubmissionInput,
  type StudentWorkDto,
  type SubmitWorkInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import { CurrentStudent } from "../../common/auth/current-student.decorator.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import type { StudentAuthContext } from "../../common/auth/student-auth-context.js";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard.js";
import { PRIVATE_FILE_MAX_BYTES } from "../../common/storage/private-file.js";
import { UploadErrorFilter } from "../../common/upload-error.filter.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AssignmentsService } from "./assignments.service.js";

// Phase 9 / CP4 — assignments: submitted work and marking
// (docs/modules/phase-9.md §11). One controller per principal, as homework has.
// Staff routes need assignment.read / assignment.mark (owner, admin, teacher;
// never the bursar); the service re-checks the role and a teacher's own class
// and subject pairs.

@Controller("assignments")
@UseGuards(AuthGuard, PermissionsGuard)
export class AssignmentsController {
  constructor(private readonly service: AssignmentsService) {}

  /** Switch on "collect work" for a homework item, or change its settings. */
  @Put(":id/collection")
  @Permissions("assignment.mark")
  async collect(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(collectWorkSchema)) dto: CollectWorkInput,
    @Ip() ip: string,
  ): Promise<AssignmentMarkingDto> {
    return this.service.collect(authCtx, id, dto, { ipAddress: ip });
  }

  /** CP4.3 — replace the questions, in order. Only before anyone has handed in. */
  @Put(":id/questions")
  @Permissions("assignment.mark")
  async setQuestions(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setAssignmentQuestionsSchema)) dto: SetAssignmentQuestionsInput,
    @Ip() ip: string,
  ): Promise<AssignmentMarkingDto> {
    return this.service.setQuestions(authCtx, id, dto, { ipAddress: ip });
  }

  /** CP4.3 — approved multiple-choice bank questions for this class level and subject. */
  @Get(":id/bank-questions")
  @Permissions("assignment.mark")
  async bankQuestions(@CurrentUser() authCtx: AuthContext, @Param("id") id: string): Promise<BankQuestionListResponse> {
    return this.service.bankQuestions(authCtx, id);
  }

  /** CP4.3 — use the automatic mark for work that is only answers to the questions. */
  @Post(":id/auto-marks")
  @HttpCode(200)
  @Permissions("assignment.mark")
  async useAutoMarks(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<AssignmentMarkingDto> {
    return this.service.useAutoMarks(authCtx, id, { ipAddress: ip });
  }

  @Get(":id/submissions")
  @Permissions("assignment.read")
  async marking(@CurrentUser() authCtx: AuthContext, @Param("id") id: string): Promise<AssignmentMarkingDto> {
    return this.service.marking(authCtx, id);
  }

  @Get(":id/students/:studentId")
  @Permissions("assignment.read")
  async studentWork(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Param("studentId") studentId: string,
  ): Promise<StudentWorkDto> {
    return this.service.studentWork(authCtx, id, studentId);
  }

  @Post(":id/release")
  @HttpCode(200)
  @Permissions("assignment.mark")
  async release(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<AssignmentMarkingDto> {
    return this.service.release(authCtx, id, { ipAddress: ip });
  }

  @Post("submissions/:id/mark")
  @HttpCode(200)
  @Permissions("assignment.mark")
  async mark(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(markSubmissionSchema)) dto: MarkSubmissionInput,
    @Ip() ip: string,
  ): Promise<StudentWorkDto> {
    return this.service.mark(authCtx, id, dto, { ipAddress: ip });
  }

  /** CP4.2 — a five-minute link to a handed-in photo or PDF, audited. */
  @Get("files/:fileId")
  @Permissions("assignment.read")
  async file(
    @CurrentUser() authCtx: AuthContext,
    @Param("fileId") fileId: string,
    @Ip() ip: string,
  ): Promise<AssignmentFileUrlDto> {
    return this.service.fileUrlForStaff(authCtx, fileId, { ipAddress: ip });
  }

  @Post("submissions/:id/return")
  @HttpCode(200)
  @Permissions("assignment.mark")
  async returnWork(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(returnSubmissionSchema)) dto: ReturnSubmissionInput,
    @Ip() ip: string,
  ): Promise<StudentWorkDto> {
    return this.service.returnWork(authCtx, id, dto, { ipAddress: ip });
  }
}

@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalAssignmentsController {
  constructor(private readonly service: AssignmentsService) {}

  /** What was handed in, and the mark once released. No answer text. */
  @Get("students/:id/assignments")
  async forChild(
    @CurrentGuardian() ctx: GuardianAuthContext,
    @Param("id") id: string,
  ): Promise<FamilyAssignmentListResponse> {
    return this.service.listForGuardian(ctx, id);
  }

  /** CP4.2 — a five-minute link to a file the child handed in (Q8). */
  @Get("students/:id/assignment-files/:fileId")
  async file(
    @CurrentGuardian() ctx: GuardianAuthContext,
    @Param("id") id: string,
    @Param("fileId") fileId: string,
  ): Promise<AssignmentFileUrlDto> {
    return this.service.fileUrlForGuardian(ctx, id, fileId);
  }
}

@Controller("student-portal")
@UseGuards(StudentAuthGuard)
export class StudentAssignmentsController {
  constructor(private readonly service: AssignmentsService) {}

  // The session is the identity: no student id in any path.
  @Get("me/assignments")
  async list(@CurrentStudent() ctx: StudentAuthContext): Promise<FamilyAssignmentListResponse> {
    return this.service.listForStudent(ctx.schoolId, ctx.studentId);
  }

  @Get("me/assignments/:id")
  async get(@CurrentStudent() ctx: StudentAuthContext, @Param("id") id: string): Promise<MyAssignmentDto> {
    return this.service.getForStudent(ctx.schoolId, ctx.studentId, id);
  }

  @Post("me/assignments/:id/submit")
  @HttpCode(200)
  async submit(
    @CurrentStudent() ctx: StudentAuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(submitWorkSchema)) dto: SubmitWorkInput,
  ): Promise<MyAssignmentDto> {
    return this.service.submitForStudent(ctx.schoolId, ctx.studentId, id, dto);
  }

  // CP4.2 — attach a photo or PDF (F1: typed by its bytes, at most 10 MB, up to
  // three). It waits, staged, until the student hands in.
  @Post("me/assignments/:id/files")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PRIVATE_FILE_MAX_BYTES } }))
  @UseFilters(new UploadErrorFilter("10 MB"))
  async stage(
    @CurrentStudent() ctx: StudentAuthContext,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<MyAssignmentDto> {
    if (!file) {
      throw new ValidationError("INVALID_UPLOAD", "No file uploaded. Use multipart/form-data with a 'file' field.");
    }
    return this.service.stageFile(ctx.schoolId, ctx.studentId, id, file.buffer);
  }

  @Delete("me/assignments/:id/files/:fileId")
  async unstage(
    @CurrentStudent() ctx: StudentAuthContext,
    @Param("id") id: string,
    @Param("fileId") fileId: string,
  ): Promise<MyAssignmentDto> {
    return this.service.removeStagedFile(ctx.schoolId, ctx.studentId, id, fileId);
  }

  @Get("me/assignments/files/:fileId")
  async file(@CurrentStudent() ctx: StudentAuthContext, @Param("fileId") fileId: string): Promise<AssignmentFileUrlDto> {
    return this.service.fileUrlForStudent(ctx.schoolId, ctx.studentId, fileId);
  }
}
