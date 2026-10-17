import { Body, Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import {
  requestHostelExeatSchema,
  type PortalHostelExeatDto,
  type PortalStudentHostelDto,
  type RequestHostelExeatInput,
} from "@school-kit/types";

import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { HostelExeatService } from "./hostel-exeat.service.js";
import { HostelHouseService } from "./hostel-house.service.js";

// Phase 9 / CP6b.2 — a guardian reads their own child's hostel, room and bed
// this term and the house masters' names (docs/modules/phase-9.md §15
// CP6b-D8). Behind withGuardian. null when the child is not a boarder this
// term. No visitor log: parents do not see it (owner, §15.8).
//
// Phase 9 / CP6b.3 — and asks for, follows and cancels the child's leave out
// (exeats, CP6b-D6). Any linked guardian may ask (owner's answer 5).
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalHostelController {
  constructor(
    private readonly service: HostelHouseService,
    private readonly exeats: HostelExeatService,
  ) {}

  @Get("students/:id/hostel")
  hostel(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<PortalStudentHostelDto | null> {
    return this.service.hostelForGuardian(guardianCtx, id);
  }

  @Get("students/:id/exeats")
  listExeats(@CurrentGuardian() guardianCtx: GuardianAuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<PortalHostelExeatDto[]> {
    return this.exeats.listForGuardian(guardianCtx, id);
  }

  @Post("students/:id/exeats")
  @HttpCode(201)
  requestExeat(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(requestHostelExeatSchema)) dto: RequestHostelExeatInput,
    @Ip() ip: string,
  ): Promise<PortalHostelExeatDto> {
    return this.exeats.requestForGuardian(guardianCtx, id, dto, { ipAddress: ip });
  }

  @Post("students/:id/exeats/:exeatId/cancel")
  @HttpCode(200)
  cancelExeat(
    @CurrentGuardian() guardianCtx: GuardianAuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("exeatId", new ParseUUIDPipe()) exeatId: string,
    @Ip() ip: string,
  ): Promise<PortalHostelExeatDto> {
    return this.exeats.cancelForGuardian(guardianCtx, id, exeatId, { ipAddress: ip });
  }
}
