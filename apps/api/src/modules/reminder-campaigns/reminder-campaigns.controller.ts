import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  confirmReminderCampaignSchema,
  prepareReminderCampaignSchema,
  refreshReminderCampaignSchema,
  type ConfirmReminderCampaignInput,
  type PrepareReminderCampaignInput,
  type RefreshReminderCampaignInput,
  type ReminderCampaignDto,
  type ReminderCampaignProposalDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { ReminderCampaignsService } from "./reminder-campaigns.service";

// Durable fee reminder campaigns (docs/modules/reminder-campaigns.md). Every
// route needs finance.debtors.remind; the service re-checks it with
// finance.debtors.read, the person's active status, the school and (to start
// or resume sending) the "reminder-campaigns" switch, in its own transaction.
@Controller("finance/reminder-campaigns")
@UseGuards(AuthGuard, PermissionsGuard)
export class ReminderCampaignsController {
  constructor(private readonly service: ReminderCampaignsService) {}

  @Get("availability")
  @Permissions("finance.debtors.remind")
  available(@CurrentUser() auth: AuthContext): Promise<{ enabled: boolean }> {
    return this.service.available(auth);
  }

  @Post("proposals")
  @HttpCode(200)
  @Permissions("finance.debtors.remind")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  prepare(@CurrentUser() auth: AuthContext, @Body(new ZodValidationPipe(prepareReminderCampaignSchema)) body: PrepareReminderCampaignInput, @Ip() ip: string): Promise<ReminderCampaignProposalDto> {
    return this.service.prepare(auth, body, ip);
  }

  @Get("proposals/:id")
  @Permissions("finance.debtors.remind")
  getProposal(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string): Promise<ReminderCampaignProposalDto> {
    return this.service.getProposal(auth, id);
  }

  @Post("proposals/:id/refresh")
  @HttpCode(200)
  @Permissions("finance.debtors.remind")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(refreshReminderCampaignSchema)) body: RefreshReminderCampaignInput, @Ip() ip: string): Promise<ReminderCampaignProposalDto> {
    return this.service.refresh(auth, id, body.clientRequestId, ip);
  }

  @Post("proposals/:id/confirm")
  @HttpCode(200)
  @Permissions("finance.debtors.remind")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  confirm(@CurrentUser() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(confirmReminderCampaignSchema)) body: ConfirmReminderCampaignInput, @Ip() ip: string): Promise<ReminderCampaignDto> {
    return this.service.confirm(auth, id, body.previewHash, ip);
  }

  @Get(":campaignId")
  @Permissions("finance.debtors.remind")
  get(@CurrentUser() auth: AuthContext, @Param("campaignId", ParseUUIDPipe) id: string): Promise<ReminderCampaignDto> {
    return this.service.getCampaign(auth, id);
  }

  @Post(":campaignId/halt")
  @HttpCode(200)
  @Permissions("finance.debtors.remind")
  halt(@CurrentUser() auth: AuthContext, @Param("campaignId", ParseUUIDPipe) id: string, @Ip() ip: string): Promise<ReminderCampaignDto> {
    return this.service.halt(auth, id, ip);
  }

  @Post(":campaignId/resume")
  @HttpCode(200)
  @Permissions("finance.debtors.remind")
  resume(@CurrentUser() auth: AuthContext, @Param("campaignId", ParseUUIDPipe) id: string, @Ip() ip: string): Promise<ReminderCampaignDto> {
    return this.service.resume(auth, id, ip);
  }
}
