import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import {
  confirmStudentIntakeSchema,
  prepareStudentIntakeSchema,
  refreshStudentIntakeSchema,
  type ConfirmStudentIntakeInput,
  type PrepareStudentIntakeInput,
  type RefreshStudentIntakeInput,
  type StudentIntakeProposalDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { StudentIntakeService } from "./student-intake.service";

// Reviewed student intake (docs/modules/student-intake-proposals.md).
// Every route needs student.create; the service re-checks it, the person's
// active status, an owner or admin role and (for writes) the school's
// "student-intake" switch, inside its own transaction.
@Controller("student-intake")
@UseGuards(AuthGuard, PermissionsGuard)
export class StudentIntakeController {
  constructor(private readonly service: StudentIntakeService) {}

  @Get("availability")
  @Permissions("student.create")
  available(@CurrentUser() auth: AuthContext): Promise<{ enabled: boolean }> {
    return this.service.available(auth);
  }

  @Post("proposals")
  @HttpCode(200)
  @Permissions("student.create")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  prepare(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(prepareStudentIntakeSchema)) body: PrepareStudentIntakeInput,
    @Ip() ip: string,
  ): Promise<StudentIntakeProposalDto> {
    return this.service.prepare(auth, body, ip);
  }

  @Get("proposals/:id")
  @Permissions("student.create")
  get(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string): Promise<StudentIntakeProposalDto> {
    return this.service.get(auth, id);
  }

  @Post("proposals/:id/confirm")
  @HttpCode(200)
  @Permissions("student.create")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  confirm(
    @CurrentUser() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(confirmStudentIntakeSchema)) body: ConfirmStudentIntakeInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<StudentIntakeProposalDto> {
    return this.service.confirm(auth, id, body.previewHash, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }

  @Post("proposals/:id/refresh")
  @HttpCode(200)
  @Permissions("student.create")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(
    @CurrentUser() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(refreshStudentIntakeSchema)) body: RefreshStudentIntakeInput,
    @Ip() ip: string,
  ): Promise<StudentIntakeProposalDto> {
    return this.service.refresh(auth, id, body.clientRequestId, ip);
  }
}
