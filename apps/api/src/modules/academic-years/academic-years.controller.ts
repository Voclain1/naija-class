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
  createAcademicYearSchema,
  updateAcademicYearSchema,
  type AcademicYearDto,
  type CreateAcademicYearInput,
  type UpdateAcademicYearInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AcademicYearsService } from "./academic-years.service";

@Controller("academic-years")
@UseGuards(AuthGuard)
export class AcademicYearsController {
  constructor(private readonly service: AcademicYearsService) {}

  @Get()
  async list(@CurrentUser() authCtx: AuthContext): Promise<AcademicYearDto[]> {
    return this.service.list(authCtx);
  }

  @Get(":id")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<AcademicYearDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createAcademicYearSchema)) dto: CreateAcademicYearInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AcademicYearDto> {
    return this.service.create(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAcademicYearSchema)) dto: UpdateAcademicYearInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AcademicYearDto> {
    return this.service.update(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Delete(":id")
  @HttpCode(204)
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

  @Post(":id/set-current")
  @HttpCode(200)
  async setCurrent(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AcademicYearDto> {
    return this.service.setCurrent(authCtx, id, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
