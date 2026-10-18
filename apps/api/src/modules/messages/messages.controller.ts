import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  listMessagesSchema,
  markHandledSchema,
  officeStartMessageSchema,
  passMessageSchema,
  replyMessageSchema,
  searchMessageGuardiansSchema,
  setMessagingRolesSchema,
  type ListMessagesInput,
  type MarkHandledInput,
  type MessageGuardianOptionDto,
  type MessagingStaffDto,
  type OfficeStartMessageInput,
  type PassMessageInput,
  type ReplyMessageInput,
  type SearchMessageGuardiansInput,
  type SetMessagingRolesInput,
  type StaffMessageListDto,
  type StaffMessageThreadDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { MessagesSettingsService } from "./messages-settings.service.js";
import { MessagesService } from "./messages.service.js";

// Phase 9 / CP8.1 — the school's side of messaging (docs/modules/phase-9.md
// §17.8). messages.read / messages.reply: owner, admin, teacher, bursar and
// the appointed principal, head teacher and Inbox officer. The service narrows
// each to the conversations addressed or passed to them. messages.start: the
// school office. messages.settings: appointing them (owner, admin).
@Controller("messages")
@UseGuards(AuthGuard, PermissionsGuard)
export class MessagesController {
  constructor(
    private readonly service: MessagesService,
    private readonly settings: MessagesSettingsService,
  ) {}

  @Get("settings/staff")
  @Permissions("messages.settings")
  staff(@CurrentUser() authCtx: AuthContext): Promise<MessagingStaffDto[]> {
    return this.settings.staff(authCtx);
  }

  @Put("settings/staff")
  @Permissions("messages.settings")
  setRoles(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(setMessagingRolesSchema)) dto: SetMessagingRolesInput,
    @Ip() ip: string,
  ): Promise<MessagingStaffDto[]> {
    return this.settings.setRoles(authCtx, dto, { ipAddress: ip });
  }

  @Get("guardians")
  @Permissions("messages.start")
  guardians(@CurrentUser() authCtx: AuthContext, @Query(new ZodValidationPipe(searchMessageGuardiansSchema)) query: SearchMessageGuardiansInput): Promise<MessageGuardianOptionDto[]> {
    return this.service.searchGuardians(authCtx, query.q);
  }

  @Post()
  @HttpCode(201)
  @Permissions("messages.start")
  start(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(officeStartMessageSchema)) dto: OfficeStartMessageInput,
    @Ip() ip: string,
  ): Promise<StaffMessageThreadDto> {
    return this.service.officeStart(authCtx, dto, { ipAddress: ip });
  }

  @Get()
  @Permissions("messages.read")
  list(@CurrentUser() authCtx: AuthContext, @Query(new ZodValidationPipe(listMessagesSchema)) query: ListMessagesInput): Promise<StaffMessageListDto> {
    return this.service.list(authCtx, query);
  }

  @Get(":id")
  @Permissions("messages.read")
  get(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<StaffMessageThreadDto> {
    return this.service.get(authCtx, id);
  }

  @Post(":id/reply")
  @Permissions("messages.reply")
  reply(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(replyMessageSchema)) dto: ReplyMessageInput,
    @Ip() ip: string,
  ): Promise<StaffMessageThreadDto> {
    return this.service.reply(authCtx, id, dto, { ipAddress: ip });
  }

  @Post(":id/pass")
  @HttpCode(200)
  @Permissions("messages.reply")
  pass(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(passMessageSchema)) dto: PassMessageInput,
    @Ip() ip: string,
  ): Promise<StaffMessageThreadDto> {
    return this.service.pass(authCtx, id, dto, { ipAddress: ip });
  }

  @Post(":id/handled")
  @HttpCode(200)
  @Permissions("messages.reply")
  handled(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(markHandledSchema)) dto: MarkHandledInput,
    @Ip() ip: string,
  ): Promise<StaffMessageThreadDto> {
    return this.service.markHandled(authCtx, id, dto, { ipAddress: ip });
  }

  @Post(":id/close")
  @HttpCode(200)
  @Permissions("messages.reply")
  close(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<StaffMessageThreadDto> {
    return this.service.close(authCtx, id, { ipAddress: ip });
  }
}
