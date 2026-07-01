import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  generateInvoicesSchema,
  listInvoicesSchema,
  previewInvoicesSchema,
  type GenerateInvoicesInput,
  type GenerateInvoicesResponseDto,
  type InvoiceDto,
  type ListInvoicesInput,
  type PaginatedInvoicesDto,
  type PreviewInvoicesInput,
  type PreviewLineDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { InvoiceGenerationService } from "./invoice-generation.service.js";

@Controller("invoices")
@UseGuards(AuthGuard, PermissionsGuard)
export class InvoicesController {
  constructor(private readonly service: InvoiceGenerationService) {}

  // ─── Static sub-paths first (before /:id) ─────────────────────────────────
  // NestJS matches routes in declaration order: "arm/preview" and "arm/generate"
  // must be declared before ":id" and ":id/cancel" to avoid "arm" being captured
  // as an ID parameter.

  @Get("arm/preview")
  @Permissions("invoice.read")
  async preview(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(previewInvoicesSchema)) query: PreviewInvoicesInput,
  ): Promise<PreviewLineDto[]> {
    return this.service.previewForArm(authCtx, query);
  }

  @Post("arm/generate")
  @HttpCode(201)
  @Permissions("invoice.issue")
  async generate(
    @Body(new ZodValidationPipe(generateInvoicesSchema)) dto: GenerateInvoicesInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<GenerateInvoicesResponseDto> {
    return this.service.generateForArm(authCtx, dto, { ipAddress: ip });
  }

  // ─── Dynamic routes ────────────────────────────────────────────────────────

  @Get()
  @Permissions("invoice.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listInvoicesSchema)) query: ListInvoicesInput,
  ): Promise<PaginatedInvoicesDto> {
    return this.service.findAll(authCtx, query);
  }

  @Get(":id")
  @Permissions("invoice.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<InvoiceDto> {
    return this.service.findById(authCtx, id);
  }

  @Post(":id/cancel")
  @Permissions("invoice.cancel")
  async cancel(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<InvoiceDto> {
    return this.service.cancel(authCtx, id, { ipAddress: ip });
  }
}
