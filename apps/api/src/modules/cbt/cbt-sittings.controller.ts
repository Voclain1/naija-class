import { Body, Controller, Delete, Get, HttpCode, Ip, Param, Post, Put, Query, UseGuards } from "@nestjs/common";

import {
  createCbtSittingSchema,
  listCbtSittingsQuerySchema,
  updateCbtSittingSchema,
  type CbtCandidateRowDto,
  type CbtInvigilatorSheetDto,
  type CbtSchedulablePaperDto,
  type CbtSittingDto,
  type CbtSittingSummaryDto,
  type CreateCbtSittingInput,
  type ListCbtSittingsQuery,
  type UpdateCbtSittingInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { CbtSittingsService } from "./cbt-sittings.service.js";

// Online exams (CBT1) — scheduling sittings (docs/modules/cbt.md D1–D3). Staff
// only. Two-layer gate, as for exam papers: @Permissions authorises the role;
// the service holds a teacher to the subjects they teach at each level (D62).

@Controller("cbt")
@UseGuards(AuthGuard, PermissionsGuard)
export class CbtSittingsController {
  constructor(private readonly service: CbtSittingsService) {}

  /** FINAL papers that can be sat online. */
  @Get("papers")
  @Permissions("cbt.manage")
  schedulablePapers(@CurrentUser() authCtx: AuthContext): Promise<CbtSchedulablePaperDto[]> {
    return this.service.schedulablePapers(authCtx);
  }

  @Get("sittings")
  @Permissions("cbt.read")
  list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listCbtSittingsQuerySchema)) query: ListCbtSittingsQuery,
  ): Promise<CbtSittingSummaryDto[]> {
    return this.service.list(authCtx, query);
  }

  @Get("sittings/:id")
  @Permissions("cbt.read")
  get(@CurrentUser() authCtx: AuthContext, @Param("id") id: string): Promise<CbtSittingDto> {
    return this.service.get(authCtx, id);
  }

  @Get("sittings/:id/candidates")
  @Permissions("cbt.read")
  candidates(@CurrentUser() authCtx: AuthContext, @Param("id") id: string): Promise<CbtCandidateRowDto[]> {
    return this.service.candidates(authCtx, id);
  }

  /** The access and unlock codes. Audited on every read (D3). */
  @Get("sittings/:id/invigilator-sheet")
  @Permissions("cbt.manage")
  invigilatorSheet(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<CbtInvigilatorSheetDto> {
    return this.service.invigilatorSheet(authCtx, id, { ipAddress: ip });
  }

  @Post("sittings")
  @HttpCode(201)
  @Permissions("cbt.manage")
  create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createCbtSittingSchema)) input: CreateCbtSittingInput,
    @Ip() ip: string,
  ): Promise<CbtSittingDto> {
    return this.service.create(authCtx, input, { ipAddress: ip });
  }

  @Put("sittings/:id")
  @Permissions("cbt.manage")
  update(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCbtSittingSchema)) input: UpdateCbtSittingInput,
    @Ip() ip: string,
  ): Promise<CbtSittingDto> {
    return this.service.update(authCtx, id, input, { ipAddress: ip });
  }

  @Delete("sittings/:id")
  @HttpCode(204)
  @Permissions("cbt.manage")
  remove(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<void> {
    return this.service.remove(authCtx, id, { ipAddress: ip });
  }

  @Post("sittings/:id/publish")
  @HttpCode(200)
  @Permissions("cbt.manage")
  publish(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<CbtSittingDto> {
    return this.service.publish(authCtx, id, { ipAddress: ip });
  }

  @Post("sittings/:id/unpublish")
  @HttpCode(200)
  @Permissions("cbt.manage")
  unpublish(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<CbtSittingDto> {
    return this.service.unpublish(authCtx, id, { ipAddress: ip });
  }

  @Post("sittings/:id/close")
  @HttpCode(200)
  @Permissions("cbt.manage")
  close(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<CbtSittingDto> {
    return this.service.close(authCtx, id, { ipAddress: ip });
  }
}
