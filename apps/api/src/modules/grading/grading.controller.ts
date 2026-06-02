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
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { GradingService } from "./grading.service";

// NOTE: slice-1-era guarding — AuthGuard only, with the service gating via
// assertUserActiveAndHasOneOf(['owner','admin']). @Permissions + PermissionsGuard
// are wired in the Phase 2 slice-9 RBAC rollup (mirrors Phase 1 slice 13).
// Until then, granting grading perms to admin early would be a no-op anyway.

function reqContext(ip: string, req: Request) {
  return { ipAddress: ip, userAgent: req.header("user-agent") ?? null };
}

@Controller("grading-scheme")
@UseGuards(AuthGuard)
export class GradingSchemeController {
  constructor(private readonly service: GradingService) {}

  @Get()
  async getScheme(@CurrentUser() authCtx: AuthContext): Promise<GradingSchemeDto> {
    return this.service.getScheme(authCtx);
  }

  @Patch()
  async updateScheme(
    @Body(new ZodValidationPipe(updateGradingSchemeSchema)) dto: UpdateGradingSchemeInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GradingSchemeDto> {
    return this.service.updateScheme(authCtx, dto, reqContext(ip, req));
  }

  @Get("components")
  async listComponents(@CurrentUser() authCtx: AuthContext): Promise<GradingComponentDto[]> {
    return this.service.listComponents(authCtx);
  }

  @Post("components")
  @HttpCode(201)
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
  async replaceComponents(
    @Body(new ZodValidationPipe(replaceGradingComponentsSchema)) dto: ReplaceGradingComponentsInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GradingSchemeDto> {
    return this.service.replaceComponents(authCtx, dto, reqContext(ip, req));
  }

  @Patch("components/:id")
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
@UseGuards(AuthGuard)
export class GradeBoundariesController {
  constructor(private readonly service: GradingService) {}

  @Get()
  async listBoundaries(@CurrentUser() authCtx: AuthContext): Promise<GradeBoundaryDto[]> {
    return this.service.listBoundaries(authCtx);
  }

  // Bulk replace — the settings UI save path (ranges tile 0..100).
  @Put()
  async replaceBoundaries(
    @Body(new ZodValidationPipe(replaceGradeBoundariesSchema)) dto: ReplaceGradeBoundariesInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GradeBoundaryDto[]> {
    return this.service.replaceBoundaries(authCtx, dto, reqContext(ip, req));
  }

  @Patch(":id")
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
