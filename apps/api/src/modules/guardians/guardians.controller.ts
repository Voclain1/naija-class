import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  createAndLinkGuardianSchema,
  createGuardianSchema,
  linkExistingGuardianSchema,
  listGuardiansQuerySchema,
  updateGuardianSchema,
  updateStudentGuardianLinkSchema,
  type CreateAndLinkGuardianInput,
  type CreateGuardianInput,
  type CreateStudentGuardianLinkResponse,
  type GuardianDetailDto,
  type GuardianDto,
  type GuardianListResponse,
  type InviteGuardianResponse,
  type LinkExistingGuardianInput,
  type ListGuardiansQuery,
  type UpdateGuardianInput,
  type UpdateStudentGuardianLinkInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { GuardiansService } from "./guardians.service";

// Slice 5 controller. Two route prefixes live here for cohesion:
//   - /guardians/*           — flat guardian CRUD
//   - /students/:studentId/guardians/*  — nested link creation
//   - /student-guardians/:id — flat link PATCH/DELETE
// Each handler builds its own reqCtx the same way StudentsController does.
//
// Authz: AuthGuard + PermissionsGuard (slice 13). The student-guardian link
// operations have no dedicated permission string — they are gated by the
// parent guardian.{create,update,delete} verbs (linking is a guardian
// mutation). Service-layer asserts stay as defense-in-depth.
@Controller()
@UseGuards(AuthGuard, PermissionsGuard)
export class GuardiansController {
  constructor(private readonly service: GuardiansService) {}

  // ----- /guardians ----------------------------------------------------

  @Get("guardians")
  @Permissions("guardian.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listGuardiansQuerySchema))
    query: ListGuardiansQuery,
  ): Promise<GuardianListResponse> {
    return this.service.list(authCtx, query);
  }

  @Get("guardians/:id")
  @Permissions("guardian.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<GuardianDetailDto> {
    return this.service.findById(authCtx, id);
  }

  @Post("guardians")
  @HttpCode(201)
  @Permissions("guardian.create")
  async create(
    @Body(new ZodValidationPipe(createGuardianSchema)) dto: CreateGuardianInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GuardianDto> {
    return this.service.create(authCtx, dto, requestContext(ip, req));
  }

  @Patch("guardians/:id")
  @Permissions("guardian.update")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateGuardianSchema)) dto: UpdateGuardianInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GuardianDto> {
    return this.service.update(authCtx, id, dto, requestContext(ip, req));
  }

  // Phase 4 / Slice 2 — admin-triggered guardian portal invitation (D2).
  // No request body — see GuardiansService.invite's own comment.
  @Post("guardians/:id/invite")
  @HttpCode(200)
  @Permissions("guardian.invite")
  async invite(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<InviteGuardianResponse> {
    return this.service.invite(authCtx, id, requestContext(ip, req));
  }

  @Delete("guardians/:id")
  @HttpCode(204)
  @Permissions("guardian.delete")
  async delete(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.delete(authCtx, id, requestContext(ip, req));
  }

  // ----- /students/:studentId/guardians (nested link) ------------------

  @Post("students/:studentId/guardians")
  @HttpCode(201)
  @Permissions("guardian.create")
  async linkExisting(
    @Param("studentId") studentId: string,
    @Body(new ZodValidationPipe(linkExistingGuardianSchema))
    dto: LinkExistingGuardianInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<CreateStudentGuardianLinkResponse> {
    return this.service.linkExisting(authCtx, studentId, dto, requestContext(ip, req));
  }

  @Post("students/:studentId/guardians/new")
  @HttpCode(201)
  @Permissions("guardian.create")
  async createAndLink(
    @Param("studentId") studentId: string,
    @Body(new ZodValidationPipe(createAndLinkGuardianSchema))
    dto: CreateAndLinkGuardianInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<CreateStudentGuardianLinkResponse> {
    return this.service.createAndLink(authCtx, studentId, dto, requestContext(ip, req));
  }

  // ----- /student-guardians/:id (flat link operations) -----------------

  @Patch("student-guardians/:id")
  @Permissions("guardian.update")
  async updateLink(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateStudentGuardianLinkSchema))
    dto: UpdateStudentGuardianLinkInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<CreateStudentGuardianLinkResponse> {
    return this.service.updateLink(authCtx, id, dto, requestContext(ip, req));
  }

  @Delete("student-guardians/:id")
  @HttpCode(204)
  @Permissions("guardian.delete")
  async unlink(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.unlink(authCtx, id, requestContext(ip, req));
  }
}

function requestContext(ip: string, req: Request) {
  return {
    ipAddress: ip,
    userAgent: req.header("user-agent") ?? null,
  };
}
