import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ValidationError,
  onboardingStep1Schema,
  onboardingStep2Schema,
  onboardingStep3Schema,
  onboardingStep4Schema,
  onboardingStep5Schema,
  patchSchoolSchema,
  type OnboardingStepResponse,
  type PatchSchoolInput,
  type SchoolMeDto,
} from "@school-kit/types";
import type { Request } from "express";
import type { ZodError, ZodSchema } from "zod";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  SchoolsService,
  type OnboardingStepPayload,
} from "./schools.service";

@Controller("schools")
@UseGuards(AuthGuard)
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  // GET /schools/me — any authed user can read their own school.
  @Get("me")
  async findMe(@CurrentUser() authCtx: AuthContext): Promise<SchoolMeDto> {
    return this.schoolsService.findMe(authCtx);
  }

  // PATCH /schools/me — owner or admin updates basics + branding.
  // The Zod pipe rejects unknown keys (`.strict()`) and empty `{}`
  // (`.refine(len > 0)`), so the service only ever sees a non-empty,
  // type-safe partial.
  @Patch("me")
  async patchMe(
    @Body(new ZodValidationPipe(patchSchoolSchema)) dto: PatchSchoolInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<SchoolMeDto> {
    return this.schoolsService.patchMe(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // POST /schools/me/onboarding/:step — owner-only.
  //
  // One handler for all five steps because the URL pattern is the same and
  // Nest does not natively support body-schema dispatch on the value of a
  // path param. We validate :step is 1..5 (via ParseIntPipe + a range check),
  // then pick the matching Zod schema for the body. The service is handed a
  // discriminated union so it can never see a step/body mismatch.
  //
  // 200 (not 201) because the resource being mutated is the existing school
  // row, not a new one being created. The Invitation rows that step 3 creates
  // are a side-effect, not the primary returned resource.
  @Post("me/onboarding/:step")
  @HttpCode(200)
  async advanceOnboarding(
    @Param("step", ParseIntPipe) step: number,
    @Body() rawBody: unknown,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<OnboardingStepResponse> {
    const payload = parseStepPayload(step, rawBody);
    return this.schoolsService.advanceOnboarding(authCtx, payload, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}

// Picks the right schema per step, parses, and returns a discriminated union.
// We deliberately do NOT use ZodValidationPipe here because the schema choice
// depends on a path param that arrives after the pipe's transform runs.
// Errors are shaped identically to ZodValidationPipe so the client sees one
// stable VALIDATION_ERROR envelope across the whole API.
function parseStepPayload(step: number, raw: unknown): OnboardingStepPayload {
  switch (step) {
    case 1:
      return { step: 1, data: parseOrThrow(onboardingStep1Schema, raw) };
    case 2:
      return { step: 2, data: parseOrThrow(onboardingStep2Schema, raw) };
    case 3:
      return { step: 3, data: parseOrThrow(onboardingStep3Schema, raw) };
    case 4:
      return { step: 4, data: parseOrThrow(onboardingStep4Schema, raw) };
    case 5:
      return { step: 5, data: parseOrThrow(onboardingStep5Schema, raw) };
    default:
      throw new ValidationError("step must be an integer between 1 and 5", {
        issues: [{ path: "step", code: "out_of_range", message: `got ${step}` }],
      });
  }
}

function parseOrThrow<T>(schema: ZodSchema<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new ValidationError("Invalid request payload", formatZodIssues(result.error));
}

function formatZodIssues(err: ZodError) {
  return {
    issues: err.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    })),
  };
}
