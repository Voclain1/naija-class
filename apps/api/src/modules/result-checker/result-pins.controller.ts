import { Body, Controller, Get, HttpCode, Ip, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  generateResultPinBatchSchema,
  voidResultPinSchema,
  type GenerateResultPinBatchInput,
  type GeneratedResultPinBatchDto,
  type ResultPinBatchListResponse,
  type VoidResultPinInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ResultPinService } from "./result-pin.service";

function reqContext(ip: string, req: Request) {
  return { ipAddress: ip, userAgent: req.header("user-agent") ?? null };
}

// Result Checker PIN batches (§21.3) — owner/admin, behind the usual two
// layers: the permission here, the role re-check in the service.
@Controller("result-pins")
@UseGuards(AuthGuard, PermissionsGuard)
export class ResultPinsController {
  constructor(private readonly pins: ResultPinService) {}

  @Get("batches")
  @Permissions("result-pin.read")
  async list(@CurrentUser() authCtx: AuthContext): Promise<ResultPinBatchListResponse> {
    return this.pins.listBatches(authCtx);
  }

  // The response is the only copy of these PINs that will ever exist (D16).
  @Post("batches")
  @Permissions("result-pin.manage")
  async generate(
    @Body(new ZodValidationPipe(generateResultPinBatchSchema)) dto: GenerateResultPinBatchInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<GeneratedResultPinBatchDto> {
    return this.pins.generateBatch(authCtx, dto, reqContext(ip, req));
  }

  @Post("batches/:id/void")
  @HttpCode(200)
  @Permissions("result-pin.manage")
  async voidBatch(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<{ voided: true }> {
    return this.pins.voidBatch(authCtx, id, reqContext(ip, req));
  }

  @Post("void")
  @HttpCode(200)
  @Permissions("result-pin.manage")
  async voidPin(
    @Body(new ZodValidationPipe(voidResultPinSchema)) dto: VoidResultPinInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<{ voided: true }> {
    return this.pins.voidPin(authCtx, dto.serial, reqContext(ip, req));
  }
}
