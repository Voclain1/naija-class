import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";

import {
  announcementEmailPreviewSchema,
  createAnnouncementSchema,
  type AnnouncementBouncedDto,
  type AnnouncementEmailPreviewDto,
  type AnnouncementEmailPreviewInput,
  type AnnouncementDto,
  type AnnouncementFeedResponse,
  type AnnouncementListResponse,
  type CreateAnnouncementInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard.js";
import { CurrentStudent } from "../../common/auth/current-student.decorator.js";
import type { StudentAuthContext } from "../../common/auth/student-auth-context.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { AnnouncementEmailService } from "./announcement-email.service.js";
import { AnnouncementsService } from "./announcements.service.js";

// Announcements (docs/modules/announcements.md), one controller per
// principal — the same shape devices uses, and for the same reason: three
// different guards, one service.
//
// Two-layer gate on the staff side: @Permissions authorizes the role's grant,
// and the service re-checks the owner/admin ROLE for sending (A1), so a
// custom role granted announcement.create still cannot message a school.

@Controller("announcements")
@UseGuards(AuthGuard, PermissionsGuard)
export class AnnouncementsController {
  constructor(
    private readonly service: AnnouncementsService,
    private readonly emails: AnnouncementEmailService,
  ) {}

  // Phase 9 / CP8.3: how many addresses "Also email families" would reach,
  // and what is left of today's plan allowance.
  @Get("email-preview")
  @Permissions("announcement.create")
  async emailPreview(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(announcementEmailPreviewSchema)) query: AnnouncementEmailPreviewInput,
  ): Promise<AnnouncementEmailPreviewDto> {
    return this.emails.preview(authCtx, query);
  }

  // CP8.3: the addresses that bounced or complained, for the school to fix.
  @Get(":id/bounced")
  @Permissions("announcement.create")
  async bounced(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<AnnouncementBouncedDto[]> {
    return this.emails.bounced(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("announcement.create")
  async create(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createAnnouncementSchema)) dto: CreateAnnouncementInput,
    @Ip() ip: string,
  ): Promise<AnnouncementDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  @Get()
  @Permissions("announcement.read")
  async list(@CurrentUser() authCtx: AuthContext): Promise<AnnouncementListResponse> {
    return this.service.list(authCtx);
  }

  /** What this staff member should see in their own app. */
  @Get("feed")
  @Permissions("announcement.read")
  async feed(@CurrentUser() authCtx: AuthContext): Promise<AnnouncementFeedResponse> {
    return this.service.staffFeed(authCtx);
  }

  @Post(":id/withdraw")
  @HttpCode(200)
  @Permissions("announcement.create")
  async withdraw(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<AnnouncementDto> {
    return this.service.withdraw(authCtx, id, { ipAddress: ip });
  }

  @Post(":id/read")
  @HttpCode(204)
  @Permissions("announcement.read")
  async read(@CurrentUser() authCtx: AuthContext, @Param("id") id: string): Promise<void> {
    await this.service.markRead(authCtx.schoolId, id, "STAFF", authCtx.userId);
  }
}

@Controller("portal/announcements")
@UseGuards(GuardianAuthGuard)
export class PortalAnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  @Get()
  async feed(@CurrentGuardian() ctx: GuardianAuthContext): Promise<AnnouncementFeedResponse> {
    return this.service.guardianFeed(ctx.schoolId, ctx.guardianId);
  }

  @Post(":id/read")
  @HttpCode(204)
  async read(@CurrentGuardian() ctx: GuardianAuthContext, @Param("id") id: string): Promise<void> {
    await this.service.markRead(ctx.schoolId, id, "GUARDIAN", ctx.guardianId);
  }
}

@Controller("student-portal/announcements")
@UseGuards(StudentAuthGuard)
export class StudentAnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  @Get()
  async feed(@CurrentStudent() ctx: StudentAuthContext): Promise<AnnouncementFeedResponse> {
    return this.service.studentFeed(ctx.schoolId, ctx.studentId);
  }

  @Post(":id/read")
  @HttpCode(204)
  async read(@CurrentStudent() ctx: StudentAuthContext, @Param("id") id: string): Promise<void> {
    await this.service.markRead(ctx.schoolId, id, "STUDENT", ctx.studentId);
  }
}
