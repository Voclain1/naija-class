import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  endIdCardSchema,
  issueIdCardsSchema,
  listIdCardsQuerySchema,
  printIdCardsSchema,
  type EndIdCardInput,
  type IdCardHolderListDto,
  type IdCardVerificationDto,
  type IssueIdCardsInput,
  type IssueIdCardsResultDto,
  type ListIdCardsQuery,
  type MyIdCardDto,
  type PrintIdCardsDto,
  type PrintIdCardsInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentStudent } from "../../common/auth/current-student.decorator.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import type { StudentAuthContext } from "../../common/auth/student-auth-context.js";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { IdCardsService } from "./id-cards.service.js";

// ID cards (docs/modules/id-cards-and-store.md §3). Staff routes need
// id-card.read / id-card.issue (owner, admin); a person's own card needs
// only to be signed in; the QR check is public, with a per-address limit.

@Controller("id-cards")
@UseGuards(AuthGuard)
export class IdCardsController {
  constructor(private readonly service: IdCardsService) {}

  // Your own card, for the staff app. Registered before ":id" routes.
  @Get("me")
  async mine(@CurrentUser() authCtx: AuthContext): Promise<MyIdCardDto> {
    return this.service.mineAsStaff(authCtx);
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @Permissions("id-card.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listIdCardsQuerySchema)) query: ListIdCardsQuery,
  ): Promise<IdCardHolderListDto> {
    return this.service.list(authCtx, query);
  }

  @Post("issue")
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @Permissions("id-card.issue")
  async issue(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(issueIdCardsSchema)) body: IssueIdCardsInput,
    @Ip() ip: string,
  ): Promise<IssueIdCardsResultDto> {
    return this.service.issue(authCtx, body, { ipAddress: ip });
  }

  @Post("print")
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @Permissions("id-card.read")
  async print(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(printIdCardsSchema)) body: PrintIdCardsInput,
  ): Promise<PrintIdCardsDto> {
    return this.service.print(authCtx, body.cardIds);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @Permissions("id-card.issue")
  async cancel(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(endIdCardSchema)) body: EndIdCardInput,
    @Ip() ip: string,
  ): Promise<{ ok: true }> {
    return this.service.cancel(authCtx, id, body.reason, { ipAddress: ip });
  }

  @Post(":id/reissue")
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @Permissions("id-card.issue")
  async reissue(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(endIdCardSchema)) body: EndIdCardInput,
    @Ip() ip: string,
  ): Promise<{ id: string }> {
    return this.service.reissue(authCtx, id, body.reason, { ipAddress: ip });
  }
}

@Controller("student-portal")
@UseGuards(StudentAuthGuard)
export class StudentIdCardController {
  constructor(private readonly service: IdCardsService) {}

  @Get("me/id-card")
  async mine(@CurrentStudent() ctx: StudentAuthContext): Promise<MyIdCardDto> {
    return this.service.mineAsStudent(ctx.schoolId, ctx.studentId);
  }
}

// The QR check (owner's answer 3). No guard, like the result checker; the
// code itself is the credential and shows only what the card's front shows.
@Controller("id-card-check")
export class IdCardCheckController {
  constructor(private readonly service: IdCardsService) {}

  @Get(":token")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async verify(@Param("token") token: string): Promise<IdCardVerificationDto> {
    return this.service.verify(token);
  }
}
