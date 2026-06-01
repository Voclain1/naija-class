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
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  createTermSchema,
  updateTermSchema,
  type CreateTermInput,
  type TermDto,
  type UpdateTermInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { TermsService } from "./terms.service";

// TermsController has NO class-level prefix on purpose: it owns BOTH the
// nested-create URLs (/academic-years/:yearId/terms) AND the flat-edit
// URLs (/terms/:id). This is the Phase-1 "nested-create, flat-edit"
// convention — see plan G in the slice 1 plan, and CLAUDE.md when extended.
// Subsequent slices' child-resource controllers (class arms, class subjects,
// student guardians) will copy this shape.
@Controller()
@UseGuards(AuthGuard, PermissionsGuard)
export class TermsController {
  constructor(private readonly service: TermsService) {}

  // -----------------------------------------------------------------------
  // nested under academic-years
  // -----------------------------------------------------------------------

  @Get("academic-years/:yearId/terms")
  @Permissions("term.read")
  async listForYear(
    @CurrentUser() authCtx: AuthContext,
    @Param("yearId") yearId: string,
  ): Promise<TermDto[]> {
    return this.service.listForYear(authCtx, yearId);
  }

  @Post("academic-years/:yearId/terms")
  @HttpCode(201)
  @Permissions("term.create")
  async create(
    @Param("yearId") yearId: string,
    @Body(new ZodValidationPipe(createTermSchema)) dto: CreateTermInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<TermDto> {
    return this.service.create(authCtx, yearId, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // -----------------------------------------------------------------------
  // flat by id
  // -----------------------------------------------------------------------

  @Get("terms/:id")
  @Permissions("term.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<TermDto> {
    return this.service.findById(authCtx, id);
  }

  @Patch("terms/:id")
  @Permissions("term.update")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateTermSchema)) dto: UpdateTermInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<TermDto> {
    return this.service.update(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Delete("terms/:id")
  @HttpCode(204)
  @Permissions("term.delete")
  async delete(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.delete(authCtx, id, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Post("terms/:id/set-current")
  @HttpCode(200)
  @Permissions("term.update")
  async setCurrent(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<TermDto> {
    return this.service.setCurrent(authCtx, id, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
