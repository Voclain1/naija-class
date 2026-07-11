import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  createStaffBankAccountSchema,
  verifyStaffBankAccountSchema,
  type CreateStaffBankAccountInput,
  type StaffBankAccountDto,
  type VerifyBankAccountResultDto,
  type VerifyStaffBankAccountInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { StaffBankAccountService } from "./staff-bank-account.service.js";

// Gated by payroll.process (not a new permission string) — setting up WHERE
// a staff member's salary goes is routine payroll administration, the same
// tier as creating/approving a PayrollItem. Only the actual transfer
// (payroll.transfer) is the admin+owner-only money-movement act.
@Controller("staff-bank-accounts")
@UseGuards(AuthGuard, PermissionsGuard)
export class StaffBankAccountController {
  constructor(private readonly service: StaffBankAccountService) {}

  // POST /staff-bank-accounts/verify — read-only preview (CP4 plan-first D1).
  // Must be declared BEFORE ":userId" so Nest's route matcher doesn't treat
  // "verify" as a userId path param.
  @Post("verify")
  @HttpCode(200)
  @Permissions("payroll.process")
  async verify(
    @Body(new ZodValidationPipe(verifyStaffBankAccountSchema)) dto: VerifyStaffBankAccountInput,
  ): Promise<VerifyBankAccountResultDto> {
    return this.service.verify(dto);
  }

  @Post()
  @HttpCode(201)
  @Permissions("payroll.process")
  async create(
    @Body(new ZodValidationPipe(createStaffBankAccountSchema)) dto: CreateStaffBankAccountInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<StaffBankAccountDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  @Get(":userId")
  @Permissions("payroll.process")
  async findByUser(
    @CurrentUser() authCtx: AuthContext,
    @Param("userId") userId: string,
  ): Promise<StaffBankAccountDto | null> {
    return this.service.findByUser(authCtx, userId);
  }

  // DELETE deactivates (sets active=false) — row preserved for audit trail,
  // same convention as DiscountRulesController's deactivate.
  @Delete(":id")
  @HttpCode(204)
  @Permissions("payroll.process")
  async deactivate(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.deactivate(authCtx, id, { ipAddress: ip });
  }
}
