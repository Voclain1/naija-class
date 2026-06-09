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
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  createGradingComponentSchema,
  replaceGradeBoundariesSchema,
  replaceGradingComponentsSchema,
  updateGradeBoundarySchema,
  updateGradingComponentSchema,
  updateGradingSchemeSchema,
  type CreateGradingComponentInput,
  type GradeBoundaryDto,
  type GradingComponentDto,
  type GradingSchemeDto,
  type ReplaceGradeBoundariesInput,
  type ReplaceGradingComponentsInput,
  type UpdateGradeBoundaryInput,
  type UpdateGradingComponentInput,
  type UpdateGradingSchemeInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { GradingService } from "./grading.service";

// Grading config is owner/admin-only: every handler carries a grading-* permission
// (PermissionsGuard, slice-9 rollup), and the teacher role is NOT granted any of
// them. The service's assertUserActiveAndHasOneOf(['owner','admin']) stays as
// defense-in-depth.

function reqContext(ip: string, req: Request) {
  return { ipAddress: ip, userAgent: req.header("user-agent") ?? null };
}

@Controller("grading-scheme")
@UseGuards(AuthGuard, PermissionsGuard)
export class GradingSchemeController {
  constructor(private readonly service: GradingService) {}

  @Get()
  @Permissions("grading-scheme.read")
  async getScheme(@CurrentUser() authCtx: AuthContext): Promise<GradingSchemeDto> {
    return this.service.getScheme(authCtx);
  }

  @Patch()
  @Permissions("grading-scheme.update")
  async updateScheme(
    @Body(new ZodValidationPipe(updateGradingSchemeSchema)) dto: UpdateGradingSchemeInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GradingSchemeDto> {
    return this.service.updateScheme(authCtx, dto, reqContext(ip, req));
  }

  @Get("components")
  @Permissions("grading-component.read")
  async listComponents(@CurrentUser() authCtx: AuthContext): Promise<GradingComponentDto[]> {
    return this.service.listComponents(authCtx);
  }

  @Post("components")
  @HttpCode(201)
  @Permissions("grading-component.create")
  async createComponent(
    @Body(new ZodValidationPipe(createGradingComponentSchema)) dto: CreateGradingComponentInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GradingComponentDto> {
    return this.service.createComponent(authCtx, dto, reqContext(ip, req));
  }

  // Bulk replace — the settings UI save path (sum-to-100 over the whole set).
  @Put("components")
  @Permissions("grading-component.update")
  async replaceComponents(
    @Body(new ZodValidationPipe(replaceGradingComponentsSchema)) dto: ReplaceGradingComponentsInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GradingSchemeDto> {
    return this.service.replaceComponents(authCtx, dto, reqContext(ip, req));
  }

  @Patch("components/:id")
  @Permissions("grading-component.update")
  async updateComponent(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateGradingComponentSchema)) dto: UpdateGradingComponentInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GradingComponentDto> {
    return this.service.updateComponent(authCtx, id, dto, reqContext(ip, req));
  }

  @Delete("components/:id")
  @HttpCode(204)
  @Permissions("grading-component.delete")
  async deleteComponent(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.deleteComponent(authCtx, id, reqContext(ip, req));
  }
}

@Controller("grade-boundaries")
@UseGuards(AuthGuard, PermissionsGuard)
export class GradeBoundariesController {
  constructor(private readonly service: GradingService) {}

  @Get()
  @Permissions("grade-boundary.read")
  async listBoundaries(@CurrentUser() authCtx: AuthContext): Promise<GradeBoundaryDto[]> {
    return this.service.listBoundaries(authCtx);
  }

  // Bulk replace — the settings UI save path (ranges tile 0..100).
  @Put()
  @Permissions("grade-boundary.update")
  async replaceBoundaries(
    @Body(new ZodValidationPipe(replaceGradeBoundariesSchema)) dto: ReplaceGradeBoundariesInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GradeBoundaryDto[]> {
    return this.service.replaceBoundaries(authCtx, dto, reqContext(ip, req));
  }

  @Patch(":id")
  @Permissions("grade-boundary.update")
  async updateBoundary(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateGradeBoundarySchema)) dto: UpdateGradeBoundaryInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GradeBoundaryDto> {
    return this.service.updateBoundary(authCtx, id, dto, reqContext(ip, req));
  }
}
