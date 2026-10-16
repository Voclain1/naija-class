import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import {
  listArmChargesSchema,
  listStudentChargesSchema,
  raiseStudentChargeSchema,
  voidStudentChargeSchema,
  type ArmChargesStudentDto,
  type ListArmChargesInput,
  type ListStudentChargesInput,
  type RaiseStudentChargeInput,
  type StudentChargeDto,
  type VoidStudentChargeInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { StudentChargeService } from "./student-charge.service.js";

// Phase 9 / CP5.1 — student charges (docs/modules/phase-9.md §13). Owner,
// admin and bursar; the service re-checks the role on every call. Billing the
// waiting ones onto a supplementary invoice lives on /invoices.
@Controller("student-charges")
@UseGuards(AuthGuard, PermissionsGuard)
export class StudentChargesController {
  constructor(private readonly service: StudentChargeService) {}

  @Get()
  @Permissions("charge.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listStudentChargesSchema)) query: ListStudentChargesInput,
  ): Promise<StudentChargeDto[]> {
    return this.service.list(authCtx, query);
  }

  @Get("arm")
  @Permissions("charge.read")
  async listForArm(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listArmChargesSchema)) query: ListArmChargesInput,
  ): Promise<ArmChargesStudentDto[]> {
    return this.service.listForArm(authCtx, query);
  }

  @Post()
  @HttpCode(201)
  @Permissions("charge.raise")
  async raise(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(raiseStudentChargeSchema)) dto: RaiseStudentChargeInput,
    @Ip() ip: string,
  ): Promise<StudentChargeDto> {
    return this.service.raiseByHand(authCtx, dto, { ipAddress: ip });
  }

  @Post(":id/void")
  @HttpCode(200)
  @Permissions("charge.void")
  async void(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(voidStudentChargeSchema)) dto: VoidStudentChargeInput,
    @Ip() ip: string,
  ): Promise<StudentChargeDto> {
    return this.service.voidCharge(authCtx, id, dto, { ipAddress: ip });
  }
}
