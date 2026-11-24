import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { withTenant } from "@school-kit/db";
import type { Kobo, MessagingOverview, MessagingTopUpCheckout, MessagingTopUpRequest, MessagingWalletEntry, MessagingWalletPage } from "@school-kit/types";
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
import { META_TEMPLATE_NAMES } from "./meta-provider";

const PAGE_SIZE = 50;
const TOP_UP_REQUEST = z.object({
  clientRequestId: z.string().uuid(),
  amountKobo: z.string().regex(/^[1-9]\d{0,9}$/),
});

@Controller("messaging")
@UseGuards(AuthGuard, PermissionsGuard)
export class MessagingController {
  constructor(
    private readonly preferences: NotificationPreferencesService,
    private readonly email: EmailService,
    private readonly topUps: MessagingTopUpService,
  ) {}

  @Get("overview")
  @Permissions("notification-preferences.read")
  async overview(@CurrentUser() auth: AuthContext): Promise<MessagingOverview> {
    const preferences = await this.preferences.get(auth);
    const wallet = await getMessagingWallet(auth.schoolId);
    return {
      preferences: {
        EMAIL: preferences.emailEnabled, PUSH: preferences.pushEnabled,
        SMS: preferences.smsEnabled, WHATSAPP: false,
      },
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
        { channel: "SMS", ready: false, blockers: ["CHANNEL_DISABLED", "PRICE_MISSING"] },
        { channel: "WHATSAPP", ready: false, blockers: ["CHANNEL_DISABLED", "ONBOARDING_DISABLED"] },
      ],
      wallet: {
        availableKobo: wallet.availableKobo.toString() as Kobo,
        reservedKobo: wallet.reservedKobo.toString() as Kobo,
        lowBalance: null,
      },
      templates: META_TEMPLATE_NAMES.map((name) => ({ name, language: null, approval: "UNKNOWN" })),
      whatsapp: { status: "DISCONNECTED", billing: null },
    };
  }

  @Post("wallet/top-ups")
  @Permissions("notification-preferences.update")
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
