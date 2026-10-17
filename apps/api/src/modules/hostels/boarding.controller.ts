import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  approveHostelExeatSchema,
  hostelExeatBackSchema,
  hostelExeatLeftSchema,
  hostelVisitLeftSchema,
  listHostelExeatsSchema,
  refuseHostelExeatSchema,
  staffHostelExeatSchema,
  type ApproveHostelExeatInput,
  type HostelExeatBackInput,
  type HostelExeatDto,
  type HostelExeatLeftInput,
  type ListHostelExeatsInput,
  type RefuseHostelExeatInput,
  type StaffHostelExeatInput,
  listHostelVisitsSchema,
  logHostelVisitSchema,
  type HostelVisitDto,
  type HostelVisitLeftInput,
  type HouseBoardersDto,
  type HouseHostelDto,
  type ListHostelVisitsInput,
  type LogHostelVisitInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { HostelExeatService } from "./hostel-exeat.service.js";
import { HostelHouseService } from "./hostel-house.service.js";

// Phase 9 / CP6b.2 — what a house master keeps (docs/modules/phase-9.md §15
// CP6b-D4, D5, D7): their hostels' boarders and visitor logs. hostel.house is
// held by admin, teacher and the House master role; the service lets owner and
// admin keep every hostel and anyone else only the hostels they are assigned to.
@Controller("boarding")
@UseGuards(AuthGuard, PermissionsGuard)
export class BoardingController {
  constructor(
    private readonly service: HostelHouseService,
    private readonly exeats: HostelExeatService,
  ) {}

  @Get("hostels")
  @Permissions("hostel.house")
  hostels(@CurrentUser() authCtx: AuthContext): Promise<HouseHostelDto[]> {
    return this.service.myHostels(authCtx);
  }

  @Get("hostels/:id/boarders")
  @Permissions("hostel.house")
  boarders(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<HouseBoardersDto> {
    return this.service.boarders(authCtx, id);
  }

  @Get("hostels/:id/visits")
  @Permissions("hostel.house")
  visits(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(listHostelVisitsSchema)) query: ListHostelVisitsInput,
  ): Promise<HostelVisitDto[]> {
    return this.service.visits(authCtx, id, query);
  }

  @Post("hostels/:id/visits")
  @HttpCode(201)
  @Permissions("hostel.house")
  logVisit(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(logHostelVisitSchema)) dto: LogHostelVisitInput,
    @Ip() ip: string,
  ): Promise<HostelVisitDto> {
    return this.service.logVisit(authCtx, id, dto, { ipAddress: ip });
  }

  @Patch("visits/:id/left")
  @Permissions("hostel.house")
  visitLeft(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(hostelVisitLeftSchema)) dto: HostelVisitLeftInput,
    @Ip() ip: string,
  ): Promise<HostelVisitDto> {
    return this.service.visitLeft(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete("visits/:id")
  @HttpCode(204)
  @Permissions("hostel.house")
  deleteVisit(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<void> {
    return this.service.deleteVisit(authCtx, id, { ipAddress: ip });
  }

  // ─── Exeats (CP6b.3, §15 CP6b-D6) ─────────────────────────────────────────

  @Get("hostels/:id/exeats")
  @Permissions("hostel.house")
  listExeats(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(listHostelExeatsSchema)) query: ListHostelExeatsInput,
  ): Promise<HostelExeatDto[]> {
    return this.exeats.list(authCtx, id, query);
  }

  @Post("hostels/:id/exeats")
  @HttpCode(201)
  @Permissions("hostel.house")
  createExeat(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(staffHostelExeatSchema)) dto: StaffHostelExeatInput,
    @Ip() ip: string,
  ): Promise<HostelExeatDto> {
    return this.exeats.createForStaff(authCtx, id, dto, { ipAddress: ip });
  }

  @Post("exeats/:id/approve")
  @HttpCode(200)
  @Permissions("hostel.house")
  approveExeat(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(approveHostelExeatSchema)) dto: ApproveHostelExeatInput,
    @Ip() ip: string,
  ): Promise<HostelExeatDto> {
    return this.exeats.approve(authCtx, id, dto, { ipAddress: ip });
  }

  @Post("exeats/:id/refuse")
  @HttpCode(200)
  @Permissions("hostel.house")
  refuseExeat(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(refuseHostelExeatSchema)) dto: RefuseHostelExeatInput,
    @Ip() ip: string,
  ): Promise<HostelExeatDto> {
    return this.exeats.refuse(authCtx, id, dto, { ipAddress: ip });
  }

  @Post("exeats/:id/left")
  @HttpCode(200)
  @Permissions("hostel.house")
  exeatLeft(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(hostelExeatLeftSchema)) dto: HostelExeatLeftInput,
    @Ip() ip: string,
  ): Promise<HostelExeatDto> {
    return this.exeats.left(authCtx, id, dto, { ipAddress: ip });
  }

  @Post("exeats/:id/back")
  @HttpCode(200)
  @Permissions("hostel.house")
  exeatBack(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(hostelExeatBackSchema)) dto: HostelExeatBackInput,
    @Ip() ip: string,
  ): Promise<HostelExeatDto> {
    return this.exeats.back(authCtx, id, dto, { ipAddress: ip });
  }

  @Post("exeats/:id/cancel")
  @HttpCode(200)
  @Permissions("hostel.house")
  cancelExeat(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<HostelExeatDto> {
    return this.exeats.cancelForStaff(authCtx, id, { ipAddress: ip });
  }
}
