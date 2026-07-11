import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  createPayrollItemSchema,
  updatePayrollItemSchema,
  type CreatePayrollItemInput,
  type ListPayrollQuery,
  type PayrollItemDto,
  type PayrollStatus,
  type PayslipUrlDto,
  type UpdatePayrollItemInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { PayrollService } from "./payroll.service.js";

@Controller("payroll")
@UseGuards(AuthGuard, PermissionsGuard)
export class PayrollController {
  constructor(private readonly service: PayrollService) {}

  @Get()
  @Permissions("payroll.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query("period") period?: string,
    @Query("status") status?: PayrollStatus,
    @Query("userId") userId?: string,
  ): Promise<PayrollItemDto[]> {
    const query: ListPayrollQuery = {
      ...(period ? { period } : {}),
      ...(status ? { status } : {}),
      ...(userId ? { userId } : {}),
    };
    return this.service.findAll(authCtx, query);
  }

  @Get(":id")
  @Permissions("payroll.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<PayrollItemDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("payroll.process")
  async create(
    @Body(new ZodValidationPipe(createPayrollItemSchema)) dto: CreatePayrollItemInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<PayrollItemDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  @Patch(":id")
  @Permissions("payroll.process")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePayrollItemSchema)) dto: UpdatePayrollItemInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<PayrollItemDto> {
    return this.service.update(authCtx, id, dto, { ipAddress: ip });
  }

  @Post(":id/approve")
  @Permissions("payroll.process")
  async approve(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<PayrollItemDto> {
    return this.service.approve(authCtx, id, { ipAddress: ip });
  }

  // Generates the payslip HTML (APPROVED items only) and returns a signed
  // view URL in the same response — mirrors the create-and-return-URL shape
  // the manual gate expects, rather than splitting generate/view into two
  // calls the way payment/expense receipts do (those are uploaded once and
  // viewed many times across sessions; a payslip is generated once, right
  // after approval, by the same caller who just approved it).
  @Post(":id/payslip")
  @Permissions("payroll.process")
  async generatePayslip(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<PayslipUrlDto> {
    return this.service.generatePayslip(authCtx, id, { ipAddress: ip });
  }
}
