import { withTenant } from "@school-kit/db";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  platformAdminAuditLogQuerySchema,
  platformAdminCreateSchoolSchema,
  platformAdminListUsersQuerySchema,
  platformAdminLoginSchema,
  platformAdminDeleteSchoolSchema,
  platformAdminResendOwnerInvitationSchema,
  platformAdminSuspendSchoolSchema,
  platformAdminResolvePaystackSetupSchema,
  platformAdminSetAiBudgetSchema,
  platformAdminSetAiEnabledSchema,
  platformAdminSetEarlyAccessSchema,
  platformAdminSetStaffMobileSchema,
  platformAdminSetPlanSchema,
  platformAdminSetSmartImportSchema,
  platformAdminSetFeatureSchema,
  platformAdminDecideSmsSenderSchema,
  type PlatformAdminAuditLogQuery,
  type PlatformAdminAuditLogResponse,
  type PlatformAdminCancelOwnerInvitationResponse,
  type PlatformAdminCreateSchoolInput,
  type PlatformAdminDeleteSchoolInput,
  type PlatformAdminDeleteSchoolResponse,
  type PlatformAdminSchoolDeletionCheckDto,
  type PlatformAdminSchoolSuspensionResponse,
  type PlatformAdminSuspendSchoolInput,
  type PlatformAdminCreateSchoolResponse,
  type PlatformAdminListUsersQuery,
  type PlatformAdminLoginInput,
  type PlatformAdminLoginResponse,
  type PlatformAdminPaystackSetupRequestDto,
  type PlatformAdminPaystackSetupRevealDto,
  type PlatformAdminResendOwnerInvitationInput,
  type PlatformAdminResendOwnerInvitationResponse,
  type PlatformAdminResolvePaystackSetupInput,
  type PlatformAdminResolvePaystackSetupResponse,
  type PlatformAdminSchoolDto,
  type PlatformAdminSetAiBudgetInput,
  type PlatformAdminSetAiBudgetResponse,
  type PlatformAdminSetAiEnabledInput,
  type PlatformAdminSetAiEnabledResponse,
  type PlatformAdminSetPlanInput,
  type PlatformAdminSetPlanResponse,
  type PlatformAdminSetSmartImportInput,
  type PlatformAdminSetSmartImportResponse,
  type PlatformAdminSetFeatureInput,
  type PlatformAdminAssistantStatusDto,
  type PlatformAdminSetFeatureResponse,
  type PlatformAdminDecideSmsSenderInput,
  type PlatformAdminDecideSmsSenderResponse,
  type PlatformAdminSetEarlyAccessInput,
  type PlatformAdminSetEarlyAccessResponse,
  type PlatformAdminSetStaffMobileInput,
  type PlatformAdminSetStaffMobileResponse,
  type PlatformAdminUserDto,
  changeSchoolAddressSchema,
  type ChangeSchoolAddressInput,
  platformAdminSetVoiceBudgetSchema,
  aiReleaseAttestSchema,
  aiReleaseAuthoriseSchema,
  aiReleaseRevokeSchema,
  aiReleaseScopeSchema,
  platformAdminSetAiClassificationSchema,
  type AiReleaseAttestInput,
  type AiReleaseAuthoriseInput,
  type AiReleaseRevokeInput,
  type AiReleaseStatusDto,
  type PlatformAdminFictionalSeedResponse,
  type PlatformAdminSetAiClassificationInput,
  type PlatformAdminSetAiClassificationResponse,
  type PlatformAdminEndVoiceSessionsResponse,
  type PlatformAdminSetVoiceBudgetInput,
  type PlatformAdminSetVoiceBudgetResponse,
  type PlatformAdminVoiceStatusDto,
} from "@school-kit/types";
import type { Request } from "express";
import { z } from "zod";

import { CurrentPlatformAdmin } from "../../common/auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../../common/auth/platform-admin-context";
import { PlatformAdminGuard } from "../../common/auth/platform-admin.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AssistantActivationService } from "./assistant-activation.service";
import { messagingEmergencyState, writeMessagingEmergencyState } from "../../common/messaging-emergency-control";
import { messagingSpendLimit, writeMessagingSpendLimit } from "../../common/messaging-spend-limits";
import type { MessagingEmergencyChannel, MessagingEmergencyWrite, MessagingProviderActivationWrite, MessagingRateReviewWrite, MessagingSpendLimitWrite, MessagingTemplateReviewWrite } from "@school-kit/types";
import { messagingProviderActivation, messagingRateCatalogState, writeMessagingProviderActivation, writeMessagingRateCatalog, writeMessagingTemplateReview } from "../notifications/messaging/messaging-review-controls";
import { MetaConnectionsService } from "../notifications/messaging/meta-connections.service";
import { messagingPlatformControls } from "../notifications/messaging/paid-messaging-policy";
import { getMessagingReconciliation, getMessagingWallet, reconcileNotificationReservation } from "../notifications/messaging/messaging-wallet";
import { VoiceAdminService } from "./voice-admin.service";
import { PlatformAdminService } from "./platform-admin.service";

// Genuinely separate top-level surface — see CLAUDE.md's "Platform
// super-admin" note. /platform-admin/login is the ONLY public route here
// (mirrors PortalAuthController's "no guard on the credential endpoint
// itself" precedent); every other route requires PlatformAdminGuard.
const reviewRef = z.string().regex(/^[A-Za-z0-9._/-]{1,120}$/);
const rateReviewInput = z.object({ evidenceRef: reviewRef, rates: z.array(z.record(z.string())).max(100) }).strict();
const templateReviewInput = z.object({
  evidenceRef: reviewRef,
  review: z.object({
    wabaId: z.string(), providerTemplateId: z.string(), approvedBody: z.string(), language: z.string(),
    category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]), bodyFields: z.array(z.string()).max(20),
    paymentButtonIndex: z.number().int().optional(),
  }).strict().nullable(),
}).strict();

@Controller("platform-admin")
export class PlatformAdminController {
  constructor(
    private readonly platformAdminService: PlatformAdminService,
    private readonly assistantActivation: AssistantActivationService,
    private readonly voiceAdmin: VoiceAdminService,
    private readonly metaConnections: MetaConnectionsService,
  ) {}

  // POST /platform-admin/login — same tighter-than-global throttle as
  // staff/guardian login.
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async login(
    @Body(new ZodValidationPipe(platformAdminLoginSchema)) dto: PlatformAdminLoginInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminLoginResponse> {
    return this.platformAdminService.login(dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Get("messaging/controls")
  @UseGuards(PlatformAdminGuard)
  async messagingControls() {
    const [SMS, WHATSAPP, platformSpendLimit, smsActivation, whatsappActivation] = await Promise.all([
      messagingEmergencyState("SMS"), messagingEmergencyState("WHATSAPP"), messagingSpendLimit("platform"),
      messagingProviderActivation("SMS"), messagingProviderActivation("WHATSAPP"),
    ]);
    return {
      ...messagingPlatformControls(process.env), emergency: { SMS, WHATSAPP }, platformSpendLimit,
      providerActivation: { SMS: smsActivation, WHATSAPP: whatsappActivation },
    };
  }

  @Post("messaging/emergency-controls")
  @UseGuards(PlatformAdminGuard)
  updateMessagingEmergencyControls(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body(new ZodValidationPipe(z.object({
      channel: z.enum(["SMS", "WHATSAPP"]),
      stopped: z.boolean(),
      evidenceRef: z.string().regex(/^[A-Za-z0-9._/-]{1,120}$/),
    }).strict())) body: MessagingEmergencyWrite & { channel: MessagingEmergencyChannel },
  ) {
    const { channel, ...control } = body;
    return writeMessagingEmergencyState(channel, admin.userId, control);
  }

  @Post("messaging/spending-limit")
  @UseGuards(PlatformAdminGuard)
  updatePlatformMessagingLimit(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body(new ZodValidationPipe(z.object({
      dailyKobo: z.string().regex(/^(0|[1-9]\d{0,9})$/).nullable(),
      evidenceRef: z.string().regex(/^[A-Za-z0-9._/-]{1,120}$/),
    }).strict())) body: MessagingSpendLimitWrite,
  ) {
    return writeMessagingSpendLimit("platform", admin.userId, body);
  }

  @Get("schools/:schoolId/messaging/spending-limit")
  @UseGuards(PlatformAdminGuard)
  readSchoolMessagingLimit(@Param("schoolId", new ParseUUIDPipe()) schoolId: string) {
    return messagingSpendLimit(schoolId);
  }

  @Post("schools/:schoolId/messaging/spending-limit")
  @UseGuards(PlatformAdminGuard)
  updateSchoolMessagingLimit(
    @Param("schoolId", new ParseUUIDPipe()) schoolId: string,
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body(new ZodValidationPipe(z.object({
      dailyKobo: z.string().regex(/^(0|[1-9]\d{0,9})$/).nullable(),
      evidenceRef: z.string().regex(/^[A-Za-z0-9._/-]{1,120}$/),
    }).strict())) body: MessagingSpendLimitWrite,
  ) {
    return writeMessagingSpendLimit(schoolId, admin.userId, body);
  }

  @Post("messaging/provider-activation")
  @UseGuards(PlatformAdminGuard)
  updateMessagingProviderActivation(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body(new ZodValidationPipe(z.object({
      channel: z.enum(["SMS", "WHATSAPP"]), enabled: z.boolean(), evidenceRef: reviewRef,
    }).strict())) body: MessagingProviderActivationWrite & { channel: MessagingEmergencyChannel },
  ) {
    const { channel, ...activation } = body;
    return writeMessagingProviderActivation(channel, admin.userId, activation);
  }

  @Get("messaging/price-catalog")
  @UseGuards(PlatformAdminGuard)
  readPlatformMessagingPrices() {
    return messagingRateCatalogState("platform");
  }

  @Get("schools/:schoolId/messaging/price-catalog")
  @UseGuards(PlatformAdminGuard)
  readSchoolMessagingPrices(@Param("schoolId", new ParseUUIDPipe()) schoolId: string) {
    return messagingRateCatalogState(schoolId);
  }

  @Post("messaging/price-catalog")
  @UseGuards(PlatformAdminGuard)
  publishPlatformMessagingPrices(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body(new ZodValidationPipe(rateReviewInput)) body: MessagingRateReviewWrite,
  ) {
    return writeMessagingRateCatalog("platform", admin.userId, body);
  }

  @Post("schools/:schoolId/messaging/price-catalog")
  @UseGuards(PlatformAdminGuard)
  publishSchoolMessagingPrices(
    @Param("schoolId", new ParseUUIDPipe()) schoolId: string,
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body(new ZodValidationPipe(rateReviewInput)) body: MessagingRateReviewWrite,
  ) {
    return writeMessagingRateCatalog(schoolId, admin.userId, body);
  }

  @Post("schools/:schoolId/messaging/templates/:name/review")
  @UseGuards(PlatformAdminGuard)
  reviewSchoolMessagingTemplate(
    @Param("schoolId", new ParseUUIDPipe()) schoolId: string,
    @Param("name") name: string,
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body(new ZodValidationPipe(templateReviewInput)) body: MessagingTemplateReviewWrite,
  ) {
    return writeMessagingTemplateReview(schoolId, name, admin.userId, body);
  }

  @Get("schools/:schoolId/messaging/wallet")
  @UseGuards(PlatformAdminGuard)
  async messagingWallet(@Param("schoolId", new ParseUUIDPipe()) schoolId: string) {
    const wallet = await getMessagingWallet(schoolId);
    return { availableKobo: String(wallet.availableKobo), reservedKobo: String(wallet.reservedKobo) };
  }

  @Get("schools/:schoolId/messaging/top-up-reconciliation")
  @UseGuards(PlatformAdminGuard)
  messagingTopUpReconciliation(@Param("schoolId", new ParseUUIDPipe()) schoolId: string) {
    return withTenant(schoolId, async (db) => {
      const rows = await db.messagingWalletTopUp.findMany({
        where: { schoolId, verifiedAt: null }, take: 100, orderBy: { createdAt: "asc" },
        select: { reference: true, reconciliationCode: true, amountKobo: true, recoveryAttempts: true, createdAt: true },
      });
      return { items: rows.map((row) => ({ ...row, amountKobo: String(row.amountKobo) })) };
    });
  }

  @Get("schools/:schoolId/payments/reconciliation")
  @UseGuards(PlatformAdminGuard)
  paystackPaymentReconciliation(@Param("schoolId", new ParseUUIDPipe()) schoolId: string) {
    return withTenant(schoolId, async (db) => {
      const rows = await db.paystackPaymentException.findMany({
        where: { schoolId }, take: 100, orderBy: { createdAt: "desc" },
        select: {
          reference: true, invoiceId: true, reason: true, expectedKobo: true, observedKobo: true,
          observedCurrency: true, unappliedKobo: true, createdAt: true,
        },
      });
      return { items: rows.map((row) => ({
        ...row,
        expectedKobo: row.expectedKobo === null ? null : String(row.expectedKobo),
        observedKobo: row.observedKobo === null ? null : String(row.observedKobo),
        unappliedKobo: row.unappliedKobo === null ? null : String(row.unappliedKobo),
      })) };
    });
  }

  @Get("schools/:schoolId/messaging/reconciliation")
  @UseGuards(PlatformAdminGuard)
  messagingReconciliation(@Param("schoolId", new ParseUUIDPipe()) schoolId: string) {
    return getMessagingReconciliation(schoolId);
  }

  @Delete("schools/:schoolId/messaging/whatsapp")
  @UseGuards(PlatformAdminGuard)
  disconnectSchoolWhatsApp(
    @Param("schoolId", new ParseUUIDPipe()) schoolId: string,
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
  ) {
    return this.metaConnections.disconnectSchool(schoolId, admin.userId);
  }

  @Post("schools/:schoolId/messaging/deliveries/:deliveryId/reconcile")
  @UseGuards(PlatformAdminGuard)
  reconcileMessagingDelivery(
    @Param("schoolId", new ParseUUIDPipe()) schoolId: string,
    @Param("deliveryId", new ParseUUIDPipe()) deliveryId: string,
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body(new ZodValidationPipe(z.object({
      resolution: z.enum(["SETTLE", "RELEASE"]),
      evidenceRef: z.string().regex(/^[A-Za-z0-9._/-]{1,120}$/),
      providerChargedKobo: z.string().regex(/^(0|[1-9]\d{0,9})$/),
    }).strict())) body: { resolution: "SETTLE" | "RELEASE"; evidenceRef: string; providerChargedKobo: string },
  ) {
    return reconcileNotificationReservation({ ...body, schoolId, deliveryId, operatorId: admin.userId, providerChargedKobo: BigInt(body.providerChargedKobo) });
  }

  @Get("schools")
  @UseGuards(PlatformAdminGuard)
  async schools(
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSchoolDto[]> {
    return this.platformAdminService.listSchools(adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Get("users")
  @UseGuards(PlatformAdminGuard)
  async users(
    @Query(new ZodValidationPipe(platformAdminListUsersQuerySchema)) query: PlatformAdminListUsersQuery,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminUserDto[]> {
    return this.platformAdminService.listUsers(query.schoolId, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // GET /platform-admin/paystack-setup-requests — the operator's queue of
  // schools waiting on a subaccount. No banking fields; see the service.
  @Get("paystack-setup-requests")
  @UseGuards(PlatformAdminGuard)
  async paystackSetupRequests(
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminPaystackSetupRequestDto[]> {
    return this.platformAdminService.listPaystackSetupRequests(adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // GET /platform-admin/paystack-setup-requests/:id/reveal — the only route
  // in the product that returns a school's bank account number. Every call
  // writes a `paystack-setup.reveal` audit row. Throttled like a write, not
  // like a read: this is the one read whose repetition is itself a signal.
  @Get("paystack-setup-requests/:id/reveal")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async revealPaystackSetupRequest(
    @Param("id") id: string,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminPaystackSetupRevealDto> {
    return this.platformAdminService.revealPaystackSetupRequest(id, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // PATCH /platform-admin/paystack-setup-requests/:id — mark FULFILLED (with
  // the issued ACCT_ code) or REJECTED (with a reason the school sees).
  @Patch("paystack-setup-requests/:id")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async resolvePaystackSetupRequest(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(platformAdminResolvePaystackSetupSchema))
    dto: PlatformAdminResolvePaystackSetupInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminResolvePaystackSetupResponse> {
    return this.platformAdminService.resolvePaystackSetupRequest(id, dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // POST /platform-admin/schools — the surface's first write (2026-08-07).
  // Tighter throttle than the read endpoints: a compromised platform-admin
  // session can now trigger real school creation + real email sends to
  // arbitrary addresses, not just read data — bound the blast radius.
  @Post("schools")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async createSchool(
    @Body(new ZodValidationPipe(platformAdminCreateSchoolSchema)) dto: PlatformAdminCreateSchoolInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminCreateSchoolResponse> {
    return this.platformAdminService.createSchool(dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // PATCH /platform-admin/schools/:schoolId/early-access — sets/clears the
  // early-access marker (2026-08-09). Marker only; nothing reads it to make a
  // decision yet. Same throttle as createSchool: it's a write on a
  // cross-tenant surface, even though a much smaller one.
  @Patch("schools/:schoolId/early-access")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setEarlyAccess(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetEarlyAccessSchema))
    dto: PlatformAdminSetEarlyAccessInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetEarlyAccessResponse> {
    return this.platformAdminService.setEarlyAccess(schoolId, dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // PATCH /platform-admin/schools/:schoolId/ai — turns the per-school AI kill
  // switch on or off (2026-08-14). Same throttle as the other two writes.
  //
  // Unlike early-access this one has real teeth: false stops every AI feature
  // for the school within one request (AiGenerationService.reserve() reads it
  // on the hot path), and true is how a school is opted INTO the one-at-a-time
  // rollout that packages/db/scripts/disable-ai-per-school.ts prepares. It is
  // still bounded by the platform-wide AI_ENABLED env var, which this
  // endpoint deliberately neither reads nor reports.
  @Patch("schools/:schoolId/ai")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setAiEnabled(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetAiEnabledSchema))
    dto: PlatformAdminSetAiEnabledInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetAiEnabledResponse> {
    return this.platformAdminService.setAiEnabled(schoolId, dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // PATCH /platform-admin/schools/:schoolId/smart-import — Smart Student
  // Import's own per-school switch (2026-10-11). Read on every scan, so it
  // takes effect on the school's next request.
  @Patch("schools/:schoolId/smart-import")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setSmartImportEnabled(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetSmartImportSchema)) dto: PlatformAdminSetSmartImportInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetSmartImportResponse> {
    return this.platformAdminService.setSmartImportEnabled(schoolId, dto, adminCtx, {
      ipAddress: ip, userAgent: req.header("user-agent") ?? null,
    });
  }

  // PATCH /platform-admin/schools/:schoolId/features — one per-school feature
  // switch on or off (2026-11-06, docs/modules/feature-switches.md). Every new
  // assistant feature is gated by one of these keys and is off until the
  // operator turns it on here. Same throttle as the other per-school writes.
  @Patch("schools/:schoolId/features")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setFeatureSwitch(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetFeatureSchema)) dto: PlatformAdminSetFeatureInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetFeatureResponse> {
    return this.platformAdminService.setFeatureSwitch(schoolId, dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // GET /platform-admin/schools/:schoolId/assistant — the SchoolKit Assistant
  // for one school: each switch as stored, whether it is actually working, and
  // every reason it is not (2026-11-10, docs/modules/assistant-workspace.md,
  // "Controlled activation"). Read-only; the switches themselves are still set
  // one at a time through PATCH .../features above, so every change is audited.
  @Get("schools/:schoolId/assistant")
  @UseGuards(PlatformAdminGuard)
  async assistantStatus(@Param("schoolId") schoolId: string): Promise<PlatformAdminAssistantStatusDto> {
    return this.assistantActivation.status(schoolId);
  }

  // ---- SchoolKit Assistant AI governance (docs/modules/assistant-ai-governance.md).
  // Platform admin only (PlatformAdminGuard re-reads is_platform_admin and
  // is_active on every request). Every write is audited.

  @Get("ai-release")
  @UseGuards(PlatformAdminGuard)
  async aiReleaseStatus(): Promise<AiReleaseStatusDto> {
    return this.platformAdminService.aiReleaseStatus();
  }

  @Post("ai-release/:scope/attestations")
  @HttpCode(200)
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async attestAiRelease(
    @Param("scope", new ZodValidationPipe(aiReleaseScopeSchema)) scope: "LIVE" | "FICTIONAL",
    @Body(new ZodValidationPipe(aiReleaseAttestSchema)) dto: AiReleaseAttestInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AiReleaseStatusDto> {
    return this.platformAdminService.attestAiRelease(scope, dto, adminCtx, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }

  @Post("ai-release/:scope/authorise")
  @HttpCode(200)
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async authoriseAiRelease(
    @Param("scope", new ZodValidationPipe(aiReleaseScopeSchema)) scope: "LIVE" | "FICTIONAL",
    @Body(new ZodValidationPipe(aiReleaseAuthoriseSchema)) dto: AiReleaseAuthoriseInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AiReleaseStatusDto> {
    return this.platformAdminService.authoriseAiRelease(scope, dto, adminCtx, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }

  // The kill switch: every school of this data scope stops at its next request.
  @Post("ai-release/:scope/revoke")
  @HttpCode(200)
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async revokeAiRelease(
    @Param("scope", new ZodValidationPipe(aiReleaseScopeSchema)) scope: "LIVE" | "FICTIONAL",
    @Body(new ZodValidationPipe(aiReleaseRevokeSchema)) dto: AiReleaseRevokeInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AiReleaseStatusDto> {
    return this.platformAdminService.revokeAiRelease(scope, dto, adminCtx, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }

  @Patch("schools/:schoolId/ai-data-classification")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setAiDataClassification(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetAiClassificationSchema)) dto: PlatformAdminSetAiClassificationInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetAiClassificationResponse> {
    return this.platformAdminService.setAiDataClassification(schoolId, dto, adminCtx, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }

  @Post("schools/:schoolId/fictional-pilot/seed")
  @HttpCode(200)
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async seedFictionalPilot(
    @Param("schoolId") schoolId: string,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminFictionalSeedResponse> {
    return this.platformAdminService.seedFictionalPilot(schoolId, adminCtx, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }

  // GET /platform-admin/schools/:schoolId/voice — SchoolKit Assistant voice for
  // one school: the switch, whether it works, every blocker, this month's
  // usage and the limits (docs/modules/assistant-voice.md). Read-only; the
  // switch is set through PATCH .../features.
  @Get("schools/:schoolId/voice")
  @UseGuards(PlatformAdminGuard)
  async voiceStatus(@Param("schoolId") schoolId: string): Promise<PlatformAdminVoiceStatusDto> {
    return this.voiceAdmin.status(schoolId);
  }

  // PATCH /platform-admin/schools/:schoolId/voice-budget — monthly voice seconds.
  @Patch("schools/:schoolId/voice-budget")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setVoiceBudget(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetVoiceBudgetSchema)) dto: PlatformAdminSetVoiceBudgetInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetVoiceBudgetResponse> {
    return this.platformAdminService.setVoiceBudget(schoolId, dto, adminCtx, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }

  // POST /platform-admin/schools/:schoolId/voice/end-sessions — ends every live voice session at the school.
  @Post("schools/:schoolId/voice/end-sessions")
  @HttpCode(200)
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async endVoiceSessions(
    @Param("schoolId") schoolId: string,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminEndVoiceSessionsResponse> {
    return this.platformAdminService.endVoiceSessions(schoolId, adminCtx, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }

  // PATCH /platform-admin/schools/:schoolId/sms-sender — records the
  // networks' decision on the sender name the school asked for
  // (docs/modules/school-identity.md slice 2).
  @Patch("schools/:schoolId/sms-sender")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async decideSmsSender(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminDecideSmsSenderSchema)) dto: PlatformAdminDecideSmsSenderInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminDecideSmsSenderResponse> {
    return this.platformAdminService.decideSmsSender(schoolId, dto, adminCtx, {
      ipAddress: ip, userAgent: req.header("user-agent") ?? null,
    });
  }

  // PATCH /platform-admin/schools/:schoolId/address — SchoolKit changes a
  // school's web address (docs/modules/school-addresses.md): beyond the
  // school's own limits, never counted against them. Audited.
  @Patch("schools/:schoolId/address")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setAddress(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(changeSchoolAddressSchema)) dto: ChangeSchoolAddressInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
  ): Promise<{ schoolId: string; slug: string }> {
    return this.platformAdminService.setAddress(schoolId, dto.code, adminCtx, { ipAddress: ip });
  }

  // PATCH /platform-admin/schools/:schoolId/plan — the school's plan and an
  // optional student cap override (2026-10-11, docs/modules/plans.md D1).
  @Patch("schools/:schoolId/plan")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setPlan(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetPlanSchema)) dto: PlatformAdminSetPlanInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetPlanResponse> {
    return this.platformAdminService.setPlan(schoolId, dto, adminCtx, {
      ipAddress: ip, userAgent: req.header("user-agent") ?? null,
    });
  }

  @Patch("schools/:schoolId/staff-mobile")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setStaffMobileEnabled(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetStaffMobileSchema)) dto: PlatformAdminSetStaffMobileInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetStaffMobileResponse> {
    return this.platformAdminService.setStaffMobileEnabled(schoolId, dto, adminCtx, {
      ipAddress: ip, userAgent: req.header("user-agent") ?? null,
    });
  }

  // PATCH /platform-admin/schools/:schoolId/ai-budget — the per-school
  // monthly AI cap in tokens (null = platform default). Same throttle as the
  // other writes.
  @Patch("schools/:schoolId/ai-budget")
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async setAiBudget(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSetAiBudgetSchema)) dto: PlatformAdminSetAiBudgetInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSetAiBudgetResponse> {
    return this.platformAdminService.setAiBudget(schoolId, dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // POST /platform-admin/schools/:schoolId/owner-invitation/resend — a fresh
  // owner invitation (optionally to a corrected address) for a school that
  // has no owner yet. Sends a real email, so throttled like createSchool.
  @Post("schools/:schoolId/owner-invitation/resend")
  @HttpCode(200)
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async resendOwnerInvitation(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminResendOwnerInvitationSchema))
    dto: PlatformAdminResendOwnerInvitationInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminResendOwnerInvitationResponse> {
    return this.platformAdminService.resendOwnerInvitation(schoolId, dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // POST /platform-admin/schools/:schoolId/owner-invitation/cancel — ends
  // the school's open owner invitations without sending another.
  @Post("schools/:schoolId/owner-invitation/cancel")
  @HttpCode(200)
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async cancelOwnerInvitation(
    @Param("schoolId") schoolId: string,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminCancelOwnerInvitationResponse> {
    return this.platformAdminService.cancelOwnerInvitation(schoolId, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // ─── School lifecycle (slice 2, 2026-10-07) ─────────────────────────────

  // POST /platform-admin/schools/:schoolId/suspend — blocks every sign-in to
  // the school; live sessions end at their next request.
  @Post("schools/:schoolId/suspend")
  @HttpCode(200)
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async suspendSchool(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminSuspendSchoolSchema)) dto: PlatformAdminSuspendSchoolInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSchoolSuspensionResponse> {
    return this.platformAdminService.suspendSchool(schoolId, dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Post("schools/:schoolId/reactivate")
  @HttpCode(200)
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async reactivateSchool(
    @Param("schoolId") schoolId: string,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSchoolSuspensionResponse> {
    return this.platformAdminService.reactivateSchool(schoolId, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // GET /platform-admin/schools/:schoolId/deletion-check — counts, and
  // whether a delete is allowed. Read-only.
  @Get("schools/:schoolId/deletion-check")
  @UseGuards(PlatformAdminGuard)
  async deletionCheck(
    @Param("schoolId") schoolId: string,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminSchoolDeletionCheckDto> {
    return this.platformAdminService.deletionCheck(schoolId, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // POST /platform-admin/schools/:schoolId/delete — permanent. Only a school
  // that never recorded a payment, after the operator types its slug. Tighter
  // throttle than the other writes: nothing else here is irreversible.
  @Post("schools/:schoolId/delete")
  @HttpCode(200)
  @UseGuards(PlatformAdminGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async deleteSchool(
    @Param("schoolId") schoolId: string,
    @Body(new ZodValidationPipe(platformAdminDeleteSchoolSchema)) dto: PlatformAdminDeleteSchoolInput,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminDeleteSchoolResponse> {
    return this.platformAdminService.deleteSchool(schoolId, dto, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // GET /platform-admin/audit-log — the platform's own audit rows (slice 3).
  // Read-only, and itself audited.
  @Get("audit-log")
  @UseGuards(PlatformAdminGuard)
  async auditLog(
    @Query(new ZodValidationPipe(platformAdminAuditLogQuerySchema)) query: PlatformAdminAuditLogQuery,
    @CurrentPlatformAdmin() adminCtx: PlatformAdminContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<PlatformAdminAuditLogResponse> {
    return this.platformAdminService.listAuditLog(query, adminCtx, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
