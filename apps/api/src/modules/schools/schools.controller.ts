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
  Put,
  Query,
  Req,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ValidationError,
  createPaystackSetupRequestSchema,
  onboardingStep1Schema,
  onboardingStep2Schema,
  onboardingStep3Schema,
  onboardingStep4Schema,
  onboardingStep5Schema,
  patchSchoolSchema,
  requestSmsSenderSchema,
  changeSchoolAddressSchema,
  type ChangeSchoolAddressInput,
  type SchoolAddressCheckDto,
  type SchoolAddressDto,
  updateAdmissionNumberSettingsSchema,
  type CreatePaystackSetupRequestInput,
  type OnboardingStepResponse,
  type PatchSchoolInput,
  type PaystackSetupRequestDto,
  type SchoolLogoUrlDto,
  type SchoolMeDto,
  type SchoolPlanDto,
  type AdmissionNumberSettingsDto,
  type RequestSmsSenderInput,
  type SmsSenderDto,
  type UpdateAdmissionNumberSettingsInput,
} from "@school-kit/types";
import type { Request } from "express";
import type { ZodError, ZodType, ZodTypeDef } from "zod";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { UploadErrorFilter } from "../../common/upload-error.filter";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PaystackSetupService } from "./paystack-setup.service";
import { AdmissionNumberSettingsService } from "./admission-number-settings.service";
import { SmsSenderService } from "./sms-sender.service";
import { SchoolAddressService } from "./school-address.service";
import {
  LOGO_MAX_FILE_SIZE_BYTES,
  SchoolsService,
  type OnboardingStepPayload,
} from "./schools.service";

@Controller("schools")
@UseGuards(AuthGuard)
export class SchoolsController {
  constructor(
    private readonly schoolsService: SchoolsService,
    private readonly paystackSetup: PaystackSetupService,
    private readonly smsSender: SmsSenderService,
    private readonly admissionNumbers: AdmissionNumberSettingsService,
    private readonly address: SchoolAddressService,
  ) {}

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

  // POST /schools/me/logo — owner or admin. multipart/form-data with a
  // `file` field. Replaces the old raw logoUrl text field entirely — see
  // step2-branding.dto.ts's header comment for the full history.
  @Post("me/logo")
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: LOGO_MAX_FILE_SIZE_BYTES },
    }),
  )
  @UseFilters(new UploadErrorFilter("2 MB"))
  async uploadLogo(
    @CurrentUser() authCtx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<SchoolMeDto> {
    if (!file) {
      throw new ValidationError(
        "INVALID_UPLOAD",
        "No file uploaded. Use multipart/form-data with a 'file' field.",
      );
    }
    return this.schoolsService.uploadLogo(
      authCtx,
      { buffer: file.buffer, mimetype: file.mimetype },
      { ipAddress: ip, userAgent: req.header("user-agent") ?? null },
    );
  }

  // GET /schools/me/logo-url — any authenticated user of the school (read-
  // only branding display; no owner/admin gate). Returns a freshly-signed,
  // directly displayable image URL — see SchoolLogoUrlDto's comment.
  @Get("me/logo-url")
  async getLogoUrl(@CurrentUser() authCtx: AuthContext): Promise<SchoolLogoUrlDto> {
    return this.schoolsService.getLogoUrl(authCtx);
  }

  // GET /schools/me/plan — owner/admin. The plan, its student cap and the
  // count against it (docs/modules/plans.md).
  @Get("me/plan")
  async getPlan(@CurrentUser() authCtx: AuthContext): Promise<SchoolPlanDto> {
    return this.schoolsService.getPlan(authCtx);
  }

  // GET /schools/me/paystack-setup-request — owner/admin. Null when the
  // school has never submitted one. Deliberately does not echo back the
  // banking fields; see PaystackSetupRequestDto's comment.
  @Get("me/paystack-setup-request")
  async getPaystackSetupRequest(
    @CurrentUser() authCtx: AuthContext,
  ): Promise<PaystackSetupRequestDto | null> {
    return this.paystackSetup.findLatest(authCtx);
  }

  // POST /schools/me/paystack-setup-request — owner/admin submits banking
  // details so the platform operator can create the subaccount on SchoolKit's
  // Paystack integration. 201: this genuinely creates a new resource, unlike
  // the onboarding-step handler above.
  @Post("me/paystack-setup-request")
  async createPaystackSetupRequest(
    @Body(new ZodValidationPipe(createPaystackSetupRequestSchema))
    dto: CreatePaystackSetupRequestInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PaystackSetupRequestDto> {
    return this.paystackSetup.create(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // GET /schools/me/sms-sender — owner/admin. The school's own SMS sender
  // name and where its request stands (docs/modules/school-identity.md).
  @Get("me/sms-sender")
  async getSmsSender(@CurrentUser() authCtx: AuthContext): Promise<SmsSenderDto> {
    return this.smsSender.get(authCtx);
  }

  // POST /schools/me/sms-sender — owner/admin asks for a sender name. The
  // platform operator submits it to the networks and records the outcome.
  @Post("me/sms-sender")
  @HttpCode(200)
  async requestSmsSender(
    @Body(new ZodValidationPipe(requestSmsSenderSchema)) dto: RequestSmsSenderInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<SmsSenderDto> {
    return this.smsSender.request(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // GET /schools/me/address — owner/admin. The school's web address
  // ("<code>.schoolkit.ng"), its earlier codes, and whether the owner may
  // change it now (docs/modules/school-addresses.md).
  @Get("me/address")
  async getAddress(@CurrentUser() authCtx: AuthContext): Promise<SchoolAddressDto> {
    return this.address.get(authCtx);
  }

  // GET /schools/me/address/check?code= — owner/admin, as the owner types.
  @Get("me/address/check")
  async checkAddress(@Query("code") code: string | undefined, @CurrentUser() authCtx: AuthContext): Promise<SchoolAddressCheckDto> {
    return this.address.check(authCtx, code ?? "");
  }

  // PUT /schools/me/address — OWNER only, inside the limits. Audited.
  @Put("me/address")
  async changeAddress(
    @Body(new ZodValidationPipe(changeSchoolAddressSchema)) dto: ChangeSchoolAddressInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<SchoolAddressDto> {
    return this.address.change(authCtx, dto.code, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }

  // GET /schools/me/admission-numbers — owner/admin. How the school's
  // admission numbers are given, and the next one (docs/modules/admission-numbers.md).
  @Get("me/admission-numbers")
  async getAdmissionNumbers(@CurrentUser() authCtx: AuthContext): Promise<AdmissionNumberSettingsDto> {
    return this.admissionNumbers.get(authCtx);
  }

  // PATCH /schools/me/admission-numbers — owner/admin, audited. Answers the
  // first-time question too: either choice records that it was asked.
  @Patch("me/admission-numbers")
  async updateAdmissionNumbers(
    @Body(new ZodValidationPipe(updateAdmissionNumberSettingsSchema)) dto: UpdateAdmissionNumberSettingsInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AdmissionNumberSettingsDto> {
    return this.admissionNumbers.update(authCtx, dto, {
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

// `ZodType<T, ZodTypeDef, any>` (not the `ZodSchema<T>` shorthand, which
// fixes Input === Output === T) — onboardingStep2Schema's primaryColor now
// uses `z.preprocess`, so its Input ("" | undefined | unknown) genuinely
// differs from its Output (string | undefined). Forcing Input === T made
// every step-2 payload infer as `unknown` here, which is why the empty-
// string branding fix needed this generic loosened alongside it.
function parseOrThrow<T>(schema: ZodType<T, ZodTypeDef, unknown>, raw: unknown): T {
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
