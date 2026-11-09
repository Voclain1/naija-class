import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  confirmStudentCorrectionsSchema,
  prepareStudentCorrectionsSchema,
  refreshStudentCorrectionsSchema,
  type ConfirmStudentCorrectionsInput,
  type PrepareStudentCorrectionsInput,
  type RefreshStudentCorrectionsInput,
  type StudentCorrectionProposalDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { StudentCorrectionsService } from "./student-corrections.service";

// Reviewed student-record corrections (docs/modules/student-corrections.md).
// Every route needs student.update; the service re-checks it with
// student.read, an owner or admin role, active status, the school and (for
// writes) the "student-corrections" switch, in its own transaction.
@Controller("student-corrections")
@UseGuards(AuthGuard, PermissionsGuard)
export class StudentCorrectionsController {
  constructor(private readonly service: StudentCorrectionsService) {}

  @Get("availability")
  @Permissions("student.update")
  available(@CurrentUser() auth: AuthContext): Promise<{ enabled: boolean }> {
    return this.service.available(auth);
  }

  @Post("proposals")
  @HttpCode(200)
  @Permissions("student.update")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  prepare(@CurrentUser() auth: AuthContext, @Body(new ZodValidationPipe(prepareStudentCorrectionsSchema)) body: PrepareStudentCorrectionsInput, @Ip() ip: string): Promise<StudentCorrectionProposalDto> {
    return this.service.prepare(auth, body, ip);
  }

  @Get("proposals/:id")
  @Permissions("student.update")
  get(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string): Promise<StudentCorrectionProposalDto> {
    return this.service.get(auth, id);
  }

  @Post("proposals/:id/confirm")
  @HttpCode(200)
  @Permissions("student.update")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  confirm(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(confirmStudentCorrectionsSchema)) body: ConfirmStudentCorrectionsInput, @Ip() ip: string): Promise<StudentCorrectionProposalDto> {
    return this.service.confirm(auth, id, body.previewHash, ip);
  }

  @Post("proposals/:id/refresh")
  @HttpCode(200)
  @Permissions("student.update")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(refreshStudentCorrectionsSchema)) body: RefreshStudentCorrectionsInput, @Ip() ip: string): Promise<StudentCorrectionProposalDto> {
    return this.service.refresh(auth, id, body.clientRequestId, ip);
  }
}
