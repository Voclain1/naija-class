import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ForbiddenError,
  assistantHelpQuerySchema,
  studentLookupQuerySchema,
  type AssistantCapabilitiesDto,
  type AssistantHelpHitDto,
  type AssistantHelpQuery,
  type StudentLookupQuery,
  type StudentLookupResultDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service";
import { AssistantWorkspaceService } from "./assistant-workspace.service";
import { StudentLookupService } from "./student-lookup.service";

// The SchoolKit Assistant workspace (docs/modules/assistant-workspace.md).
// Any signed-in staff member may ask what they can do; the answer is computed
// from their own permissions. No route here writes anything or calls a model.
// Student lookup returns names to the browser only (StudentLookupService).
@Controller("assistant/workspace")
@UseGuards(AuthGuard)
export class AssistantWorkspaceController {
  constructor(
    private readonly service: AssistantWorkspaceService,
    private readonly lookup: StudentLookupService,
    private readonly features: FeatureSwitchesService,
  ) {}

  @Get("capabilities")
  capabilities(@CurrentUser() auth: AuthContext): Promise<AssistantCapabilitiesDto> {
    return this.service.capabilities(auth);
  }

  /** POST, not GET: the question must never travel in a URL (logs, history). */
  @Post("help")
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  help(@CurrentUser() auth: AuthContext, @Body(new ZodValidationPipe(assistantHelpQuerySchema)) body: AssistantHelpQuery): Promise<{ hits: AssistantHelpHitDto[] }> {
    return this.service.help(auth, body.question);
  }

  /**
   * Named student lookup from the panel's own search box (no model). POST: a
   * name never travels in a URL. Tenant from the session; the caller's role,
   * student.read and teacher scope decide what can be found.
   */
  @Post("students/find")
  @HttpCode(200)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async findStudents(@CurrentUser() auth: AuthContext, @Body(new ZodValidationPipe(studentLookupQuerySchema)) body: StudentLookupQuery): Promise<StudentLookupResultDto> {
    if (!(await this.features.isOn(auth.schoolId, "assistant-workspace"))) {
      throw new ForbiddenError("The SchoolKit Assistant is switched off for this school.");
    }
    return this.lookup.find(auth, body);
  }
}
