import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  copyPlacesSchema,
  createDriverSchema,
  createPlaceSchema,
  createRouteSchema,
  createVehicleSchema,
  dailyRouteListSchema,
  listPlacesSchema,
  listRoutesSchema,
  movePlaceSchema,
  setRouteFeeSchema,
  setStopsSchema,
  updateDriverSchema,
  updateRouteSchema,
  updateVehicleSchema,
  type CopyPlacesInput,
  type CopyPlacesResultDto,
  type CreateDriverInput,
  type CreatePlaceInput,
  type CreateRouteInput,
  type CreateVehicleInput,
  type DailyRouteListDto,
  type DailyRouteListInput,
  type ListPlacesInput,
  type ListRoutesInput,
  type MovePlaceInput,
  type SetRouteFeeInput,
  type SetRouteFeeResultDto,
  type SetStopsInput,
  type StudentTransportDto,
  type TransportDriverDto,
  type TransportPlaceDto,
  type TransportRouteDto,
  type TransportVehicleDto,
  type UpdateDriverInput,
  type UpdateRouteInput,
  type UpdateVehicleInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { TransportService } from "./transport.service.js";

// Phase 9 / CP5.2 — transport (docs/modules/phase-9.md §13). transport.read:
// owner, admin, bursar. transport.manage: owner, admin. A route's fee needs
// charge.raise instead (CP5-D11), so the bursar sets it. The service re-checks
// the role on every call.
@Controller("transport")
@UseGuards(AuthGuard, PermissionsGuard)
export class TransportController {
  constructor(private readonly service: TransportService) {}

  // ─── Vehicles ─────────────────────────────────────────────────────────────

  @Get("vehicles")
  @Permissions("transport.read")
  listVehicles(@CurrentUser() authCtx: AuthContext): Promise<TransportVehicleDto[]> {
    return this.service.listVehicles(authCtx);
  }

  @Post("vehicles")
  @HttpCode(201)
  @Permissions("transport.manage")
  createVehicle(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createVehicleSchema)) dto: CreateVehicleInput,
    @Ip() ip: string,
  ): Promise<TransportVehicleDto> {
    return this.service.createVehicle(authCtx, dto, { ipAddress: ip });
  }

  @Patch("vehicles/:id")
  @Permissions("transport.manage")
  updateVehicle(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateVehicleSchema)) dto: UpdateVehicleInput,
    @Ip() ip: string,
  ): Promise<TransportVehicleDto> {
    return this.service.updateVehicle(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete("vehicles/:id")
  @HttpCode(204)
  @Permissions("transport.manage")
  deleteVehicle(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<void> {
    return this.service.deleteVehicle(authCtx, id, { ipAddress: ip });
  }

  // ─── Drivers ──────────────────────────────────────────────────────────────

  @Get("drivers")
  @Permissions("transport.read")
  listDrivers(@CurrentUser() authCtx: AuthContext): Promise<TransportDriverDto[]> {
    return this.service.listDrivers(authCtx);
  }

  @Post("drivers")
  @HttpCode(201)
  @Permissions("transport.manage")
  createDriver(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createDriverSchema)) dto: CreateDriverInput,
    @Ip() ip: string,
  ): Promise<TransportDriverDto> {
    return this.service.createDriver(authCtx, dto, { ipAddress: ip });
  }

  @Patch("drivers/:id")
  @Permissions("transport.manage")
  updateDriver(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateDriverSchema)) dto: UpdateDriverInput,
    @Ip() ip: string,
  ): Promise<TransportDriverDto> {
    return this.service.updateDriver(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete("drivers/:id")
  @HttpCode(204)
  @Permissions("transport.manage")
  deleteDriver(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<void> {
    return this.service.deleteDriver(authCtx, id, { ipAddress: ip });
  }

  // ─── Places (static paths before routes/:id) ──────────────────────────────

  @Post("places")
  @HttpCode(201)
  @Permissions("transport.manage")
  createPlace(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createPlaceSchema)) dto: CreatePlaceInput,
    @Ip() ip: string,
  ): Promise<TransportPlaceDto> {
    return this.service.createPlace(authCtx, dto, { ipAddress: ip });
  }

  @Post("places/copy")
  @HttpCode(200)
  @Permissions("transport.manage")
  copyPlaces(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(copyPlacesSchema)) dto: CopyPlacesInput,
    @Ip() ip: string,
  ): Promise<CopyPlacesResultDto> {
    return this.service.copyPlaces(authCtx, dto, { ipAddress: ip });
  }

  @Patch("places/:id")
  @Permissions("transport.manage")
  movePlace(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(movePlaceSchema)) dto: MovePlaceInput,
    @Ip() ip: string,
  ): Promise<TransportPlaceDto> {
    return this.service.movePlace(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete("places/:id")
  @HttpCode(204)
  @Permissions("transport.manage")
  removePlace(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<void> {
    return this.service.removePlace(authCtx, id, { ipAddress: ip });
  }

  @Get("students/:studentId")
  @Permissions("transport.read")
  studentTransport(
    @CurrentUser() authCtx: AuthContext,
    @Param("studentId", new ParseUUIDPipe()) studentId: string,
  ): Promise<StudentTransportDto | null> {
    return this.service.studentTransport(authCtx, studentId);
  }

  // ─── Routes ───────────────────────────────────────────────────────────────

  @Get("routes")
  @Permissions("transport.read")
  listRoutes(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listRoutesSchema)) query: ListRoutesInput,
  ): Promise<TransportRouteDto[]> {
    return this.service.listRoutes(authCtx, query);
  }

  @Post("routes")
  @HttpCode(201)
  @Permissions("transport.manage")
  createRoute(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createRouteSchema)) dto: CreateRouteInput,
    @Ip() ip: string,
  ): Promise<TransportRouteDto> {
    return this.service.createRoute(authCtx, dto, { ipAddress: ip });
  }

  @Get("routes/:id")
  @Permissions("transport.read")
  getRoute(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(listRoutesSchema)) query: ListRoutesInput,
  ): Promise<TransportRouteDto> {
    return this.service.getRoute(authCtx, id, query);
  }

  @Patch("routes/:id")
  @Permissions("transport.manage")
  updateRoute(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateRouteSchema)) dto: UpdateRouteInput,
    @Ip() ip: string,
  ): Promise<TransportRouteDto> {
    return this.service.updateRoute(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete("routes/:id")
  @HttpCode(204)
  @Permissions("transport.manage")
  deleteRoute(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<void> {
    return this.service.deleteRoute(authCtx, id, { ipAddress: ip });
  }

  @Put("routes/:id/stops")
  @Permissions("transport.manage")
  setStops(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(setStopsSchema)) dto: SetStopsInput,
    @Ip() ip: string,
  ): Promise<TransportRouteDto> {
    return this.service.setStops(authCtx, id, dto, { ipAddress: ip });
  }

  @Put("routes/:id/fee")
  @Permissions("charge.raise")
  setFee(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(setRouteFeeSchema)) dto: SetRouteFeeInput,
    @Ip() ip: string,
  ): Promise<SetRouteFeeResultDto> {
    return this.service.setFee(authCtx, id, dto, { ipAddress: ip });
  }

  // Phase 9 / CP5.3 — the day's list for the driver, with guardians' phones.
  @Get("routes/:id/daily")
  @Permissions("transport.read")
  dailyList(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(dailyRouteListSchema)) query: DailyRouteListInput,
  ): Promise<DailyRouteListDto> {
    return this.service.dailyList(authCtx, id, query);
  }

  @Get("routes/:id/places")
  @Permissions("transport.read")
  listPlaces(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(listPlacesSchema)) query: ListPlacesInput,
  ): Promise<TransportPlaceDto[]> {
    return this.service.listPlaces(authCtx, id, query);
  }
}
