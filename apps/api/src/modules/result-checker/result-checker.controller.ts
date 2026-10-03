import { Body, Controller, Get, HttpCode, Ip, Param, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  resultCheckerCheckSchema,
  type ResultCheckerCheckInput,
  type ResultCheckerResultDto,
  type ResultCheckerSchoolDto,
} from "@school-kit/types";
import type { Request } from "express";

import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ResultCheckerService } from "./result-checker.service";

// The public Result Checker (§21.5). No guard: it is pre-login by design. The
// per-IP throttle here is one of the two enumeration defences; the other is
// the per-(school, admission number) lockout in the service.
@Controller("result-checker")
export class ResultCheckerController {
  constructor(private readonly checker: ResultCheckerService) {}

  @Get(":slug")
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async school(@Param("slug") slug: string): Promise<ResultCheckerSchoolDto> {
    return this.checker.getSchool(slug);
  }

  // Same per-IP budget as student sign-in: the same threat model.
  @Post(":slug/check")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async check(
    @Param("slug") slug: string,
    @Body(new ZodValidationPipe(resultCheckerCheckSchema)) dto: ResultCheckerCheckInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<ResultCheckerResultDto> {
    return this.checker.check(slug, dto, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }
}
