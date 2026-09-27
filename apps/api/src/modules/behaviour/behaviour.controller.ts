import { Body, Controller, Get, HttpCode, Ip, Param, Post, Query, UseGuards } from "@nestjs/common";

import {
  behaviourListQuerySchema,
  createBehaviourSchema,
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
