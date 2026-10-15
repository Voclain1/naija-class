import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query, UseGuards } from "@nestjs/common";

import {
  addSickbayMedicationSchema,
  createSickbayVisitSchema,
  sickbayVisitListQuerySchema,
  type AddSickbayMedicationInput,
  type CreateSickbayVisitInput,
  type SickbayVisitDto,
  type SickbayVisitListQuery,
  type SickbayVisitListResponse,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { SickbayService } from "./sickbay.service.js";

// Phase 9 / CP3.3 — the sickbay log, staff side (docs/modules/phase-9.md §10
// CP3-D5). Every route needs sickbay.manage (owner, admin, Health officer);
// the service checks the role as well. There is no teacher route.
@Controller("health/sickbay")
@UseGuards(AuthGuard, PermissionsGuard)
export class SickbayController {
  constructor(private readonly service: SickbayService) {}

  @Get("visits")
  @Permissions("sickbay.manage")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(sickbayVisitListQuerySchema)) query: SickbayVisitListQuery,
    @Ip() ip: string,
  ): Promise<SickbayVisitListResponse> {
    return this.service.listVisits(authCtx, query, { ipAddress: ip });
  }

  @Post("visits")
  @Permissions("sickbay.manage")
  async create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createSickbayVisitSchema)) dto: CreateSickbayVisitInput,
    @Ip() ip: string,
  ): Promise<SickbayVisitDto> {
    return this.service.createVisit(authCtx, dto, { ipAddress: ip });
  }

  @Post("visits/:id/medications")
  @Permissions("sickbay.manage")
  async addMedication(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(addSickbayMedicationSchema)) dto: AddSickbayMedicationInput,
    @Ip() ip: string,
  ): Promise<SickbayVisitDto> {
    return this.service.addMedication(authCtx, id, dto, { ipAddress: ip });
  }

  @Post("visits/:id/withdraw")
  @HttpCode(200)
  @Permissions("sickbay.manage")
  async withdraw(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<SickbayVisitDto> {
    return this.service.withdrawVisit(authCtx, id, { ipAddress: ip });
  }
}
