import { Body, Controller, Get, HttpCode, Ip, Param, Post, Put, UseGuards } from "@nestjs/common";

import {
  collectWorkSchema,
  markSubmissionSchema,
  returnSubmissionSchema,
  submitWorkSchema,
  type AssignmentMarkingDto,
  type CollectWorkInput,
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
}
