import { Body, Controller, Get, HttpCode, Ip, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";

import {
  behaviourListQuerySchema,
  behaviourIncidentListQuerySchema,
  createBehaviourCategorySchema,
  createBehaviourIncidentSchema,
  createBehaviourSchema,
  updateBehaviourCategorySchema,
  updateBehaviourSettingsSchema,
  type BehaviourCategoryDto,
  type BehaviourIncidentDto,
  type BehaviourIncidentListQuery,
  type BehaviourIncidentListResponse,
  type BehaviourIncidentOptionsDto,
  type BehaviourIncidentRosterDto,
  type CreateBehaviourIncidentInput,
  type BehaviourSettingsDto,
  type CreateBehaviourCategoryInput,
  type UpdateBehaviourCategoryInput,
  type UpdateBehaviourSettingsInput,
  type BehaviourListQuery,
  type BehaviourListResponse,
  type BehaviourRecordDto,
  type CreateBehaviourInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { BehaviourService } from "./behaviour.service.js";

// Behaviour records — ONE controller, staff only.
//
// There is deliberately no portal or student-portal controller here, unlike
// announcements and homework which have three apiece. C14: these are internal
// in v1, and the absence of a family endpoint is what makes that true rather
// than a UI decision somebody can undo.

@Controller("behaviour")
@UseGuards(AuthGuard, PermissionsGuard)
export class BehaviourController {
  constructor(private readonly service: BehaviourService) {}

  @Post()
  @HttpCode(201)
  @Permissions("behaviour.create")
  async create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createBehaviourSchema)) dto: CreateBehaviourInput,
    @Ip() ip: string,
  ): Promise<BehaviourRecordDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  @Get()
  @Permissions("behaviour.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(behaviourListQuerySchema)) query: BehaviourListQuery,
    @Ip() ip: string,
  ): Promise<BehaviourListResponse> {
    return this.service.listForStudent(authCtx, query, { ipAddress: ip });
  }

  // -------------------------------------------------------------------------
  // Phase 9 / CP2.1 — points (docs/modules/phase-9.md §9 CP2-D1). Reading the
  // settings is open to every writer, who needs the categories to offer them;
  // changing them is owner/admin only (CP2-D5).
  // -------------------------------------------------------------------------

  @Get("settings")
  @Permissions("behaviour.read")
  async settings(@CurrentUser() authCtx: AuthContext): Promise<BehaviourSettingsDto> {
    return this.service.getSettings(authCtx);
  }

  @Patch("settings")
  @Permissions("behaviour.manage")
  async updateSettings(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(updateBehaviourSettingsSchema)) dto: UpdateBehaviourSettingsInput,
    @Ip() ip: string,
  ): Promise<BehaviourSettingsDto> {
    return this.service.updateSettings(authCtx, dto, { ipAddress: ip });
  }

  @Post("categories")
  @HttpCode(201)
  @Permissions("behaviour.manage")
  async createCategory(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createBehaviourCategorySchema)) dto: CreateBehaviourCategoryInput,
    @Ip() ip: string,
  ): Promise<BehaviourCategoryDto> {
    return this.service.createCategory(authCtx, dto, { ipAddress: ip });
  }

  @Patch("categories/:id")
  @Permissions("behaviour.manage")
  async updateCategory(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateBehaviourCategorySchema)) dto: UpdateBehaviourCategoryInput,
    @Ip() ip: string,
  ): Promise<BehaviourCategoryDto> {
    return this.service.updateCategory(authCtx, id, dto, { ipAddress: ip });
  }

  // -------------------------------------------------------------------------
  // Phase 9 / CP2.2 — incidents (docs/modules/phase-9.md §9 CP2-D2). The same
  // two permissions as a single record: writing one is behaviour.create,
  // reading is behaviour.read. Scope (who may name which child, who sees
  // which incident) is the service's.
  // -------------------------------------------------------------------------

  @Get("incident-options")
  @Permissions("behaviour.create")
  async incidentOptions(@CurrentUser() authCtx: AuthContext): Promise<BehaviourIncidentOptionsDto> {
    return this.service.incidentOptions(authCtx);
  }

  @Get("incident-options/arms/:armId/students")
  @Permissions("behaviour.create")
  async incidentRoster(
    @CurrentUser() authCtx: AuthContext,
    @Param("armId") armId: string,
  ): Promise<BehaviourIncidentRosterDto> {
    return this.service.incidentRoster(authCtx, armId);
  }

  @Post("incidents")
  @HttpCode(201)
  @Permissions("behaviour.create")
  async createIncident(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createBehaviourIncidentSchema)) dto: CreateBehaviourIncidentInput,
    @Ip() ip: string,
  ): Promise<BehaviourIncidentDto> {
    return this.service.createIncident(authCtx, dto, { ipAddress: ip });
  }

  @Get("incidents")
  @Permissions("behaviour.read")
  async listIncidents(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(behaviourIncidentListQuerySchema)) query: BehaviourIncidentListQuery,
    @Ip() ip: string,
  ): Promise<BehaviourIncidentListResponse> {
    return this.service.listIncidents(authCtx, query, { ipAddress: ip });
  }

  @Get("incidents/:id")
  @Permissions("behaviour.read")
  async getIncident(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<BehaviourIncidentDto> {
    return this.service.getIncident(authCtx, id, { ipAddress: ip });
  }

  @Post("incidents/:id/withdraw")
  @HttpCode(200)
  @Permissions("behaviour.create")
  async withdrawIncident(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<BehaviourIncidentDto> {
    return this.service.withdrawIncident(authCtx, id, { ipAddress: ip });
  }

  @Post(":id/withdraw")
  @HttpCode(200)
  @Permissions("behaviour.create")
  async withdraw(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<BehaviourRecordDto> {
    return this.service.withdraw(authCtx, id, { ipAddress: ip });
  }
}
