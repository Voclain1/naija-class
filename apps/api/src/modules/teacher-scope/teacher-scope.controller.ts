import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from "@nestjs/common";
import type {
  TeacherRosterResponse,
  TeacherScopeDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { TeacherScopeService } from "./teacher-scope.service";

// Phase 1 / Slice 11 cp2 — the dedicated, scope-filtered teacher endpoints
// (Q3a). These are the ONLY endpoints a teacher session hits; admin CRUD
// (/teacher-assignments) stays owner|admin and rejects teachers. The teacher-
// role gate + scope filtering live in the service layer — the controller is
// a thin pass-through. No admin branch here: a non-teacher (owner/admin) is
// rejected with 403 by the service's role re-fetch.
@Controller("teacher-scope")
@UseGuards(AuthGuard)
export class TeacherScopeController {
  constructor(private readonly service: TeacherScopeService) {}

  // GET /teacher-scope/me — the caller's own scope (arms + subjects-by-arm).
  @Get("me")
  async getMyScope(
    @CurrentUser() authCtx: AuthContext,
  ): Promise<TeacherScopeDto> {
    return this.service.getMyScope(authCtx);
  }

  // GET /teacher-scope/me/arms/:armId/students — roster for ONE in-scope arm.
  // 404 if the arm is not in the caller's scope (or belongs to another
  // tenant) — see the service header for the 404-not-403 rationale.
  @Get("me/arms/:armId/students")
  async getMyArmRoster(
    @CurrentUser() authCtx: AuthContext,
    @Param("armId", new ParseUUIDPipe()) armId: string,
  ): Promise<TeacherRosterResponse> {
    return this.service.getMyArmRoster(authCtx, armId);
  }
}
