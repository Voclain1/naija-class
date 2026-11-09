import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { assistantHelpQuerySchema, type AssistantCapabilitiesDto, type AssistantHelpHitDto, type AssistantHelpQuery } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AssistantWorkspaceService } from "./assistant-workspace.service";

// The SchoolKit Assistant workspace (docs/modules/assistant-workspace.md).
// Any signed-in staff member may ask what they can do; the answer is computed
// from their own permissions. No route here writes anything or calls a model.
@Controller("assistant/workspace")
@UseGuards(AuthGuard)
export class AssistantWorkspaceController {
  constructor(private readonly service: AssistantWorkspaceService) {}

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
}
