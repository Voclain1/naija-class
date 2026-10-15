import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query, UseGuards } from "@nestjs/common";

import {
  createDisciplineActionSchema,
  decideDisciplineActionSchema,
  disciplineListQuerySchema,
  type CreateDisciplineActionInput,
  type DecideDisciplineActionInput,
  type DisciplineActionDto,
  type DisciplineListQuery,
  type DisciplineListResponse,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { DisciplineService } from "./discipline.service.js";

// Phase 9 / CP2.3 — discipline actions, staff side (docs/modules/phase-9.md
// §9 CP2-D3, CP2-D5). Proposing and withdrawing are `behaviour.create`, the
// same as writing a record; deciding is `behaviour.decide`, owner and admin
// only. Who may touch which child, and "never your own proposal", are the
// service's.
@Controller("behaviour/discipline")
@UseGuards(AuthGuard, PermissionsGuard)
export class DisciplineController {
  constructor(private readonly service: DisciplineService) {}

  @Post()
  @HttpCode(201)
  @Permissions("behaviour.create")
  async propose(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createDisciplineActionSchema)) dto: CreateDisciplineActionInput,
    @Ip() ip: string,
  ): Promise<DisciplineActionDto> {
    return this.service.propose(authCtx, dto, { ipAddress: ip });
  }

  @Get()
  @Permissions("behaviour.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(disciplineListQuerySchema)) query: DisciplineListQuery,
    @Ip() ip: string,
  ): Promise<DisciplineListResponse> {
    return this.service.list(authCtx, query, { ipAddress: ip });
  }

  @Post(":id/decide")
  @HttpCode(200)
  @Permissions("behaviour.decide")
  async decide(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(decideDisciplineActionSchema)) dto: DecideDisciplineActionInput,
    @Ip() ip: string,
  ): Promise<DisciplineActionDto> {
    return this.service.decide(authCtx, id, dto, { ipAddress: ip });
  }

  @Post(":id/withdraw")
  @HttpCode(200)
  @Permissions("behaviour.create")
  async withdraw(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<DisciplineActionDto> {
    return this.service.withdraw(authCtx, id, { ipAddress: ip });
  }
}
