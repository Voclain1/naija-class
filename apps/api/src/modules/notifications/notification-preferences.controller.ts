import { Body, Controller, Get, Ip, Put, Req, UseGuards } from "@nestjs/common";
import {
  updateNotificationPreferencesSchema,
  type NotificationPreferenceDto,
  type UpdateNotificationPreferencesInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { NotificationPreferencesService } from "./notification-preferences.service";

function reqContext(ip: string, req: Request) {
  return { ipAddress: ip, userAgent: req.header("user-agent") ?? null };
}

// Owner/admin-only, same as grading-scheme.* — not a highest-trust surface
// (no owner-only restriction), bursar excluded (finance-only role, this
// isn't a finance action).
@Controller("notification-preferences")
@UseGuards(AuthGuard, PermissionsGuard)
export class NotificationPreferencesController {
  constructor(private readonly service: NotificationPreferencesService) {}

  @Get()
  @Permissions("notification-preferences.read")
  async get(@CurrentUser() authCtx: AuthContext): Promise<NotificationPreferenceDto> {
    return this.service.get(authCtx);
  }

  @Put()
  @Permissions("notification-preferences.update")
  async update(
    @Body(new ZodValidationPipe(updateNotificationPreferencesSchema))
    dto: UpdateNotificationPreferencesInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<NotificationPreferenceDto> {
    return this.service.update(authCtx, dto, reqContext(ip, req));
  }
}
