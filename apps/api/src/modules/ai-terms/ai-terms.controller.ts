import { Body, Controller, Get, HttpCode, Ip, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  schoolAiTermsAcceptSchema,
  schoolAiTermsWithdrawSchema,
  type SchoolAiTermsAcceptInput,
  type SchoolAiTermsDto,
  type SchoolAiTermsWithdrawInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AiTermsService } from "./ai-terms.service.js";

// SchoolKit Assistant AI terms (docs/modules/assistant-ai-governance.md).
// Any signed-in staff member may read them; only the owner may accept or
// withdraw (checked in the service, against the database). Nothing here
// switches AI understanding on: only the platform admin can.
@Controller("schools/me/ai-terms")
@UseGuards(AuthGuard)
export class AiTermsController {
  constructor(private readonly service: AiTermsService) {}

  @Get()
  get(@CurrentUser() auth: AuthContext): Promise<SchoolAiTermsDto> {
    return this.service.get(auth);
  }

  @Post("accept")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  accept(@CurrentUser() auth: AuthContext, @Body(new ZodValidationPipe(schoolAiTermsAcceptSchema)) body: SchoolAiTermsAcceptInput, @Ip() ip: string): Promise<SchoolAiTermsDto> {
    return this.service.accept(auth, body.version, { ipAddress: ip ?? null });
  }

  @Post("withdraw")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  withdraw(@CurrentUser() auth: AuthContext, @Body(new ZodValidationPipe(schoolAiTermsWithdrawSchema)) _body: SchoolAiTermsWithdrawInput, @Ip() ip: string): Promise<SchoolAiTermsDto> {
    return this.service.withdraw(auth, { ipAddress: ip ?? null });
  }
}
