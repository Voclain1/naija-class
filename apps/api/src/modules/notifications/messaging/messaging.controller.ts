import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { withTenant } from "@school-kit/db";
import { NotFoundError } from "@school-kit/types";
import type { DeliveryState, Kobo, MessagingDeliveryPage, MessagingMetaDisconnectResult, MessagingMetaSignupCompletion, MessagingMetaSignupSession, MessagingOverview, MessagingPaidPreferences, MessagingTopUpCheckout, MessagingTopUpRequest, MessagingWalletEntry, MessagingWalletPage } from "@school-kit/types";
import { z } from "zod";

import type { AuthContext } from "../../../common/auth/auth-context";
import { AuthGuard } from "../../../common/auth/auth.guard";
import { CurrentUser } from "../../../common/auth/current-user.decorator";
import { Permissions } from "../../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../../common/auth/permissions.guard";
import { assertUserActiveAndHasOneOf } from "../../../common/auth/role-check";
import { EmailService } from "../../../common/email/email.service";
import { ZodValidationPipe } from "../../../common/zod-validation.pipe";
import { NotificationPreferencesService } from "../notification-preferences.service";
import { MessagingTopUpService } from "./messaging-top-up.service";
import { getMessagingWallet } from "./messaging-wallet";
import { MetaConnectionsService } from "./meta-connections.service";
import { PaidMessagingService } from "./paid-messaging.service";
import { META_TEMPLATE_NAMES } from "./meta-provider";

const PAGE_SIZE = 50;
const TOP_UP_REQUEST = z.object({
  clientRequestId: z.string().uuid(),
  amountKobo: z.string().regex(/^[1-9]\d{0,9}$/),
});

const META_SIGNUP = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  wabaId: z.string().regex(/^\d{1,32}$/),
  phoneNumberId: z.string().regex(/^\d{1,32}$/),
}).strict();

@Controller("messaging")
@UseGuards(AuthGuard, PermissionsGuard)
export class MessagingController {
  constructor(
    private readonly preferences: NotificationPreferencesService,
    private readonly email: EmailService,
    private readonly topUps: MessagingTopUpService,
    private readonly metaConnections: MetaConnectionsService,
    private readonly paid?: PaidMessagingService,
  ) {}

  @Get("overview")
  @Permissions("notification-preferences.read")
  async overview(@CurrentUser() auth: AuthContext): Promise<MessagingOverview> {
    const preferences = await this.preferences.get(auth);
    const [wallet, connection] = await Promise.all([
      getMessagingWallet(auth.schoolId),
      withTenant(auth.schoolId, (db) => db.messagingSchoolMetaConnection.findUnique({
        where: { schoolId: auth.schoolId }, select: { disconnectedAt: true, revokedAt: true, activationPending: true },
      })),
    ]);
    const paidPreferences = await this.preferences.getPaidChannels(auth.schoolId);
    const readiness = await this.paid?.readiness(auth.schoolId, wallet.availableKobo);
    return {
      preferences: {
        EMAIL: preferences.emailEnabled, PUSH: preferences.pushEnabled,
        SMS: preferences.smsEnabled, WHATSAPP: paidPreferences.paidWhatsAppEnabled,
      },
      paidPreferences,
      providers: [
        {
          channel: "EMAIL", ready: preferences.emailEnabled && this.email.isConfigured,
          blockers: [
            ...(!preferences.emailEnabled ? ["CHANNEL_DISABLED" as const] : []),
            ...(!this.email.isConfigured ? ["PROVIDER_UNAVAILABLE" as const] : []),
          ],
        },
        {
          channel: "PUSH", ready: preferences.pushEnabled,
          blockers: preferences.pushEnabled ? [] : ["CHANNEL_DISABLED"],
        },
        readiness?.sms ?? { channel: "SMS", ready: false, blockers: ["CHANNEL_DISABLED", "PRICE_MISSING"] },
        readiness?.whatsapp ?? { channel: "WHATSAPP", ready: false, blockers: ["CHANNEL_DISABLED", "ONBOARDING_DISABLED"] },
      ],
      wallet: {
        availableKobo: wallet.availableKobo.toString() as Kobo,
        reservedKobo: wallet.reservedKobo.toString() as Kobo,
        lowBalance: readiness?.lowBalance ?? null,
      },
      templates: META_TEMPLATE_NAMES.map((name) => ({ name, language: null, approval: "UNKNOWN" })),
      whatsapp: connection && !connection.revokedAt
        ? { status: connection.activationPending ? "PENDING" : connection.disconnectedAt ? "DISCONNECTED" : "CONNECTED", billing: "SCHOOL_OWNED" }
        : { status: "DISCONNECTED", billing: null },
    };
  }

  @Patch("preferences")
  @Permissions("messaging-paid.manage")
  updatePaidPreferences(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(z.object({
      paidWhatsAppEnabled: z.boolean(), walletSmsEnabled: z.boolean(),
    }).strict())) body: MessagingPaidPreferences,
  ): Promise<MessagingPaidPreferences> {
    return this.preferences.updatePaid(auth, body);
  }

  @Get("whatsapp/connection/health")
  @Permissions("notification-preferences.read")
  metaHealth(@CurrentUser() auth: AuthContext) {
    return this.metaConnections.health(auth);
  }

  @Get("whatsapp/templates")
  @Permissions("notification-preferences.read")
  metaTemplates(@CurrentUser() auth: AuthContext) {
    return this.metaConnections.templates(auth);
  }

  @Post("whatsapp/signup")
  @Permissions("messaging-whatsapp.manage")
  beginMetaSignup(@CurrentUser() auth: AuthContext): Promise<MessagingMetaSignupSession> {
    return this.metaConnections.begin(auth);
  }

  @Post("whatsapp/signup/complete")
  @Permissions("messaging-whatsapp.manage")
  completeMetaSignup(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(META_SIGNUP)) body: MessagingMetaSignupCompletion,
  ): Promise<{ status: "CONNECTED"; billing: "SCHOOL_OWNED" }> {
    return this.metaConnections.complete(auth, body);
  }

  @Delete("whatsapp/connection")
  @Permissions("messaging-whatsapp.manage")
  disconnectMeta(@CurrentUser() auth: AuthContext): Promise<MessagingMetaDisconnectResult> {
    return this.metaConnections.disconnect(auth);
  }

  @Get("deliveries")
  @Permissions("notification-preferences.read")
  async deliveryHistory(@CurrentUser() auth: AuthContext, @Query("cursor") cursor?: string): Promise<MessagingDeliveryPage> {
    await assertUserActiveAndHasOneOf(auth, ["owner", "admin"]);
    if (cursor !== undefined && (typeof cursor !== "string" || !/^[a-f0-9-]{36}$/i.test(cursor))) {
      throw new BadRequestException("Invalid delivery cursor");
    }
    return withTenant(auth.schoolId, async (db) => {
      const where = { schoolId: auth.schoolId, dispatchState: { not: null } };
      const anchor = cursor === undefined ? null : await db.notificationDelivery.findFirst({
        where: { ...where, id: cursor }, select: { id: true, sentAt: true },
      });
      if (cursor !== undefined && !anchor) throw new BadRequestException("Invalid delivery cursor");
      const rows = await db.notificationDelivery.findMany({
        where: {
          ...where,
          ...(anchor ? { OR: [
            { sentAt: { lt: anchor.sentAt } },
            { sentAt: anchor.sentAt, id: { lt: anchor.id } },
          ] } : {}),
        },
        orderBy: [{ sentAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1,
      });
      const items = rows.slice(0, PAGE_SIZE).map((row) => ({
        id: row.id,
        channel: row.channel === "WHATSAPP" ? "WHATSAPP" as const : "SMS" as const,
        state: (row.providerState ?? row.dispatchState ?? "UNKNOWN") as DeliveryState,
        createdAt: row.sentAt.toISOString(),
        updatedAt: (row.providerStateAt ?? row.dispatchClaimedAt ?? row.sentAt).toISOString(),
        blocker: null,
        reasonCode: row.dispatchReason ?? undefined,
        rateVersion: row.dispatchRateVersion ?? undefined,
        estimatedKobo: row.dispatchEstimateKobo === null ? undefined : String(row.dispatchEstimateKobo) as Kobo,
      }));
      return { items, nextCursor: rows.length > PAGE_SIZE ? items.at(-1)!.id : null };
    });
  }

  @Post("deliveries/:deliveryId/cancel")
  @Permissions("notification-preferences.update")
  async cancelDelivery(@CurrentUser() auth: AuthContext, @Param("deliveryId", new ParseUUIDPipe()) deliveryId: string) {
    await assertUserActiveAndHasOneOf(auth, ["owner", "admin"]);
    return withTenant(auth.schoolId, async (db) => {
      const result = await db.notificationDelivery.updateMany({
        where: { id: deliveryId, schoolId: auth.schoolId, dispatchState: "QUEUED" },
        data: { dispatchState: "CANCELLED", dispatchReason: "CANCELLED_BY_STAFF" },
      });
      if (!result.count) throw new NotFoundError("Cancellable delivery not found.");
      await db.auditLog.create({ data: {
        schoolId: auth.schoolId, userId: auth.userId, action: "messaging.delivery.cancel",
        entityType: "notification_delivery", entityId: deliveryId,
      } });
      return { status: "CANCELLED" as const };
    });
  }

  @Post("wallet/top-ups")
  @Permissions("messaging-wallet.top-up")
  checkout(
    @CurrentUser() auth: AuthContext,
    @Body(new ZodValidationPipe(TOP_UP_REQUEST)) body: MessagingTopUpRequest,
  ): Promise<MessagingTopUpCheckout> {
    return this.topUps.checkout(auth, body.clientRequestId, body.amountKobo);
  }

  @Get("wallet/transactions")
  @Permissions("notification-preferences.read")
  async walletHistory(@CurrentUser() auth: AuthContext, @Query("cursor") cursor?: string): Promise<MessagingWalletPage> {
    await assertUserActiveAndHasOneOf(auth, ["owner", "admin"]);
    if (cursor !== undefined && (typeof cursor !== "string" || !/^[a-f0-9-]{36}$/i.test(cursor))) {
      throw new BadRequestException("Invalid wallet cursor");
    }
    return withTenant(auth.schoolId, async (db) => {
      const where = { schoolId: auth.schoolId };
      const anchor = cursor === undefined ? null : await db.messagingWalletEntry.findFirst({
        where: { ...where, id: cursor }, select: { createdAt: true, id: true },
      });
      if (cursor !== undefined && !anchor) throw new BadRequestException("Invalid wallet cursor");
      const entries = await db.messagingWalletEntry.findMany({
        where: {
          ...where,
          ...(anchor ? { OR: [
            { createdAt: { lt: anchor.createdAt } },
            { createdAt: anchor.createdAt, id: { lt: anchor.id } },
          ] } : {}),
        },
        select: { id: true, kind: true, amountKobo: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PAGE_SIZE + 1,
      });
      const items: MessagingWalletEntry[] = entries.slice(0, PAGE_SIZE).map((entry) => ({
        id: entry.id, kind: entry.kind as MessagingWalletEntry["kind"],
        amountKobo: String(entry.amountKobo) as Kobo, createdAt: entry.createdAt.toISOString(),
      }));
      return { items, nextCursor: entries.length > PAGE_SIZE ? items.at(-1)!.id : null };
    });
  }
}
