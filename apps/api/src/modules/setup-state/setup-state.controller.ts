import { Controller, Get, UseGuards } from "@nestjs/common";

import type { SetupStateDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { SetupStateService } from "./setup-state.service.js";

// GET /schools/me/setup-state — backs the dashboard setup checklist and the
// prerequisite notices on the workflow screens.
//
// Sits under schools/me alongside the academic-calendar status endpoint it is
// the generalisation of, and gates the same way: AuthGuard here,
// owner/admin role check inside the service. This is school configuration,
// not a permissioned academic surface, so it takes no @Permissions decorator
// — the same call SchoolsController and AcademicCalendarController make.
//
// Unlike the calendar status endpoint, this one is NOT readable by every
// authenticated staff member. That endpoint tells a bursar why the product
// is inert, which is worth knowing; this one is a list of owner-only actions,
// and showing it to someone who cannot perform any of them is the "offer a
// button that 403s" failure this slice exists to remove.
@Controller("schools/me/setup-state")
@UseGuards(AuthGuard)
export class SetupStateController {
  constructor(private readonly service: SetupStateService) {}

  @Get()
  async get(@CurrentUser() authCtx: AuthContext): Promise<SetupStateDto> {
    return this.service.getSetupState(authCtx);
  }
}
