import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  copyBedsSchema,
  createBedSchema,
  createHostelSchema,
  listBedsSchema,
  listHostelsSchema,
  moveBedSchema,
  roomSchema,
  setHostelFeeSchema,
  setHouseMastersSchema,
  updateHostelSchema,
  updateRoomSchema,
  type CopyBedsInput,
  type CopyBedsResultDto,
  type CreateBedInput,
  type CreateHostelInput,
  type HostelBedDto,
  type HostelDto,
  type HouseMasterCandidateDto,
  type ListBedsInput,
  type ListHostelsInput,
  type MoveBedInput,
  type RoomInput,
  type SetHostelFeeInput,
  type SetHostelFeeResultDto,
  type SetHouseMastersInput,
  type StudentHostelDto,
  type UpdateHostelInput,
  type UpdateRoomInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { HostelService } from "./hostel.service.js";

// Phase 9 / CP6b.1 — hostels, rooms and beds (docs/modules/phase-9.md §15).
// hostel.read: owner, admin, bursar. hostel.manage: owner, admin. A hostel's
// fee needs charge.raise instead, so the bursar sets it, as a route's fee. The
// service re-checks the role on every call.
@Controller("hostels")
@UseGuards(AuthGuard, PermissionsGuard)
export class HostelController {
  constructor(private readonly service: HostelService) {}

  @Get()
  @Permissions("hostel.read")
  list(@CurrentUser() authCtx: AuthContext, @Query(new ZodValidationPipe(listHostelsSchema)) query: ListHostelsInput): Promise<HostelDto[]> {
    return this.service.listHostels(authCtx, query);
  }

  @Post()
  @HttpCode(201)
  @Permissions("hostel.manage")
  create(@CurrentUser() authCtx: AuthContext, @Body(new ZodValidationPipe(createHostelSchema)) dto: CreateHostelInput, @Ip() ip: string): Promise<HostelDto> {
    return this.service.createHostel(authCtx, dto, { ipAddress: ip });
  }

  @Get("house-master-candidates")
  @Permissions("hostel.manage")
  candidates(@CurrentUser() authCtx: AuthContext): Promise<HouseMasterCandidateDto[]> {
    return this.service.houseMasterCandidates(authCtx);
  }

  @Get("students/:id")
  @Permissions("hostel.read")
  studentHostel(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<StudentHostelDto | null> {
    return this.service.studentHostel(authCtx, id);
  }

  @Post("beds")
  @HttpCode(201)
  @Permissions("hostel.manage")
  place(@CurrentUser() authCtx: AuthContext, @Body(new ZodValidationPipe(createBedSchema)) dto: CreateBedInput, @Ip() ip: string): Promise<HostelBedDto> {
    return this.service.placeStudent(authCtx, dto, { ipAddress: ip });
  }

  @Post("beds/copy")
  @HttpCode(200)
  @Permissions("hostel.manage")
  copy(@CurrentUser() authCtx: AuthContext, @Body(new ZodValidationPipe(copyBedsSchema)) dto: CopyBedsInput, @Ip() ip: string): Promise<CopyBedsResultDto> {
    return this.service.copyBeds(authCtx, dto, { ipAddress: ip });
  }

  @Patch("beds/:id")
  @Permissions("hostel.manage")
  move(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(moveBedSchema)) dto: MoveBedInput,
    @Ip() ip: string,
  ): Promise<HostelBedDto> {
    return this.service.moveStudent(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete("beds/:id")
  @HttpCode(204)
  @Permissions("hostel.manage")
  remove(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<void> {
    return this.service.removeStudent(authCtx, id, { ipAddress: ip });
  }

  @Patch("rooms/:roomId")
  @Permissions("hostel.manage")
  updateRoom(
    @CurrentUser() authCtx: AuthContext,
    @Param("roomId", new ParseUUIDPipe()) roomId: string,
    @Body(new ZodValidationPipe(updateRoomSchema)) dto: UpdateRoomInput,
    @Ip() ip: string,
  ): Promise<HostelDto> {
    return this.service.updateRoom(authCtx, roomId, dto, { ipAddress: ip });
  }

  @Delete("rooms/:roomId")
  @Permissions("hostel.manage")
  deleteRoom(@CurrentUser() authCtx: AuthContext, @Param("roomId", new ParseUUIDPipe()) roomId: string, @Ip() ip: string): Promise<HostelDto> {
    return this.service.deleteRoom(authCtx, roomId, { ipAddress: ip });
  }

  @Get(":id")
  @Permissions("hostel.read")
  get(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(listHostelsSchema)) query: ListHostelsInput,
  ): Promise<HostelDto> {
    return this.service.getHostel(authCtx, id, query);
  }

  @Patch(":id")
  @Permissions("hostel.manage")
  update(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateHostelSchema)) dto: UpdateHostelInput,
    @Ip() ip: string,
  ): Promise<HostelDto> {
    return this.service.updateHostel(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete(":id")
  @HttpCode(204)
  @Permissions("hostel.manage")
  delete(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<void> {
    return this.service.deleteHostel(authCtx, id, { ipAddress: ip });
  }

  @Put(":id/fee")
  @Permissions("charge.raise")
  setFee(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(setHostelFeeSchema)) dto: SetHostelFeeInput,
    @Ip() ip: string,
  ): Promise<SetHostelFeeResultDto> {
    return this.service.setFee(authCtx, id, dto, { ipAddress: ip });
  }

  @Put(":id/house-masters")
  @Permissions("hostel.manage")
  setHouseMasters(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(setHouseMastersSchema)) dto: SetHouseMastersInput,
    @Ip() ip: string,
  ): Promise<HostelDto> {
    return this.service.setHouseMasters(authCtx, id, dto, { ipAddress: ip });
  }

  @Post(":id/rooms")
  @HttpCode(201)
  @Permissions("hostel.manage")
  createRoom(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(roomSchema)) dto: RoomInput,
    @Ip() ip: string,
  ): Promise<HostelDto> {
    return this.service.createRoom(authCtx, id, dto, { ipAddress: ip });
  }

  @Get(":id/beds")
  @Permissions("hostel.read")
  beds(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(listBedsSchema)) query: ListBedsInput,
  ): Promise<HostelBedDto[]> {
    return this.service.listBeds(authCtx, id, query);
  }
}
