import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  calendarWindowQuerySchema,
  createSchoolEventSchema,
  updateSchoolEventSchema,
  type CalendarResponse,
  type CalendarWindowQuery,
  type CreateSchoolEventInput,
  type ManagedNationalEventDto,
  type SchoolEventDto,
  type UpdateSchoolEventInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { CalendarService } from "./calendar.service.js";

// Phase 8 / CP1 — staff calendar + management. docs/modules/phase-8.md §15.
//
// Reads carry calendar-event.read, which every staff role holds (D4: visible
// to all users). Writes carry the owner/admin permissions, and the service
// re-asserts the same roles and isActive on every mutation (two gates; see
// rbac-two-gate-conformance.spec.ts).
@Controller("calendar")
@UseGuards(AuthGuard, PermissionsGuard)
export class CalendarController {
  constructor(private readonly service: CalendarService) {}

  // GET /calendar?from=&to= — the merged calendar (school events, national
  // events minus hidden ones, term boundaries).
  @Get()
  @Permissions("calendar-event.read")
  async calendar(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(calendarWindowQuerySchema)) window: CalendarWindowQuery,
  ): Promise<CalendarResponse> {
    return this.service.getStaffCalendar(authCtx, window);
  }

  @Get("events")
  @Permissions("calendar-event.read")
  async listEvents(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(calendarWindowQuerySchema)) window: CalendarWindowQuery,
  ): Promise<SchoolEventDto[]> {
    return this.service.listSchoolEvents(authCtx, window);
  }

  @Post("events")
  @HttpCode(201)
  @Permissions("calendar-event.create")
  async createEvent(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createSchoolEventSchema)) input: CreateSchoolEventInput,
    @Ip() ip: string,
  ): Promise<SchoolEventDto> {
    return this.service.createSchoolEvent(authCtx, input, { ipAddress: ip });
  }

  @Patch("events/:id")
  @Permissions("calendar-event.update")
  async updateEvent(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSchoolEventSchema)) input: UpdateSchoolEventInput,
    @Ip() ip: string,
  ): Promise<SchoolEventDto> {
    return this.service.updateSchoolEvent(authCtx, id, input, { ipAddress: ip });
  }

  @Delete("events/:id")
  @HttpCode(204)
  @Permissions("calendar-event.delete")
  async deleteEvent(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.deleteSchoolEvent(authCtx, id, { ipAddress: ip });
  }

  // National events with this school's hide state. Read-only: there is no
  // create/update/delete route for national events and there never can be a
  // working one — the runtime role cannot write that table (D22).
  @Get("national-events")
  @Permissions("calendar-event.read")
  async listNationalEvents(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(calendarWindowQuerySchema)) window: CalendarWindowQuery,
  ): Promise<ManagedNationalEventDto[]> {
    return this.service.listNationalEvents(authCtx, window);
  }

  @Put("national-events/:id/hide")
  @HttpCode(204)
  @Permissions("national-event.hide")
  async hide(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<void> {
    await this.service.hideNationalEvent(authCtx, id, { ipAddress: ip });
  }

  @Delete("national-events/:id/hide")
  @HttpCode(204)
  @Permissions("national-event.hide")
  async unhide(@CurrentUser() authCtx: AuthContext, @Param("id") id: string, @Ip() ip: string): Promise<void> {
    await this.service.unhideNationalEvent(authCtx, id, { ipAddress: ip });
  }
}
