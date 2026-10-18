import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import {
  replyMessageSchema,
  startMessageSchema,
  type MessageRecipientOptionDto,
  type PortalMessageListDto,
  type PortalMessageThreadDto,
  type ReplyMessageInput,
  type StartMessageInput,
} from "@school-kit/types";

import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { PortalMessagesService } from "./portal-messages.service.js";

// Phase 9 / CP8.1 — a guardian's own conversations with the school
// (docs/modules/phase-9.md §17.8), from the portal and the parent app. Only
// their own; about only their own children.
const recipientsQuery = z.object({ studentId: z.string().uuid().optional() });

@Controller("portal/messages")
@UseGuards(GuardianAuthGuard)
export class PortalMessagesController {
  constructor(private readonly service: PortalMessagesService) {}

  @Get()
  list(@CurrentGuardian() guardianCtx: GuardianAuthContext): Promise<PortalMessageListDto> {
    return this.service.list(guardianCtx);
  }

  @Get("recipients")
  recipients(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Query(new ZodValidationPipe(recipientsQuery)) query: z.infer<typeof recipientsQuery>,
  ): Promise<MessageRecipientOptionDto[]> {
    return this.service.recipients(guardianCtx, query.studentId ?? null);
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  start(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Body(new ZodValidationPipe(startMessageSchema)) dto: StartMessageInput,
    @Ip() ip: string,
  ): Promise<PortalMessageThreadDto> {
    return this.service.start(guardianCtx, dto, { ipAddress: ip });
  }

  @Get(":id")
  get(@CurrentGuardian() guardianCtx: GuardianAuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<PortalMessageThreadDto> {
    return this.service.get(guardianCtx, id);
  }

  @Post(":id")
  @Throttle({ default: { ttl: 3_600_000, limit: 60 } })
  reply(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(replyMessageSchema)) dto: ReplyMessageInput,
    @Ip() ip: string,
  ): Promise<PortalMessageThreadDto> {
    return this.service.reply(guardianCtx, id, dto, { ipAddress: ip });
  }
}
