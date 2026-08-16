import { Body, Controller, Get, HttpCode, Ip, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  acceptStudentInvitationSchema,
  studentLoginSchema,
  type AcceptStudentInvitationInput,
  type AcceptStudentInvitationResponse,
  type PublicStudentInvitationDto,
  type StudentLoginInput,
  type StudentLoginResponse,
  type StudentMeResponse,
} from "@school-kit/types";
import type { Request } from "express";

import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentStudent } from "../../common/auth/current-student.decorator";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard";
import type { StudentAuthContext } from "../../common/auth/student-auth-context";
import { StudentPortalService } from "./student-portal.service";

// Phase 6 / Slice 3 — the student-facing surface.
//
// Called DIRECTLY by apps/mobile with `Authorization: Bearer` and no proxy
// (ADR-002). Unlike apps/portal there is no Next.js server-side hop here:
// there is no cookie to protect, and CORS is a browser concept that does not
// apply to a native runtime.
//
// THREE PUBLIC endpoints (login + the two invitation endpoints) — none of
// them can have a session yet by definition; the credentials or the token are
// themselves the authorization. Same precedent as PortalAuthController.
@Controller("student-portal")
export class StudentPortalController {
  constructor(private readonly service: StudentPortalService) {}

  // TIGHTER than staff and guardian login (both 10/min), deliberately.
  // A student's username space is enumerable by construction — admission
  // numbers are sequential, school slugs are public (phase-6.md §14.2) — so
  // this endpoint carries brute-force risk the other two do not.
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async login(
    @Body(new ZodValidationPipe(studentLoginSchema)) dto: StudentLoginInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<StudentLoginResponse> {
    return this.service.login(dto, { ipAddress: ip, userAgent: req.header("user-agent") ?? null });
  }

  @Get("invitations/:token")
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async getInvitation(@Param("token") token: string): Promise<PublicStudentInvitationDto> {
    return this.service.getInvitation(token);
  }

  @Post("invitations/:token/accept")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async acceptInvitation(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(acceptStudentInvitationSchema)) dto: AcceptStudentInvitationInput,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<AcceptStudentInvitationResponse> {
    return this.service.acceptInvitation(token, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  // There is deliberately NO /student-portal/students/:id. Every student
  // route hangs off /me, so "can this student see this row?" is a question
  // the URL shape makes unaskable rather than one answered correctly at
  // several call sites.
  @Get("me")
  @UseGuards(StudentAuthGuard)
  async me(@CurrentStudent() ctx: StudentAuthContext): Promise<StudentMeResponse> {
    return this.service.me(ctx);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(StudentAuthGuard)
  async logout(@CurrentStudent() ctx: StudentAuthContext): Promise<void> {
    return this.service.logout(ctx);
  }
}
