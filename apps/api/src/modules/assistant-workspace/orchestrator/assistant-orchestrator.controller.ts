import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { assistantTurnSchema, type AssistantTurnDto, type AssistantTurnInput } from "@school-kit/types";

import type { AuthContext } from "../../../common/auth/auth-context";
import { AuthGuard } from "../../../common/auth/auth.guard";
import { CurrentUser } from "../../../common/auth/current-user.decorator";
import { ZodValidationPipe } from "../../../common/zod-validation.pipe";
import { AssistantOrchestratorService } from "./assistant-orchestrator.service";

// One model-backed SchoolKit Assistant turn (docs/modules/assistant-workspace.md,
// "Model orchestration"). The conversation travels in the POST body only,
// never a URL, and nothing in it is stored or logged. Tenant and user come
// from the session, never from the body. Nothing here can approve a write.
@Controller("assistant/workspace")
@UseGuards(AuthGuard)
export class AssistantOrchestratorController {
  constructor(private readonly service: AssistantOrchestratorService) {}

  @Post("turn")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  turn(@CurrentUser() auth: AuthContext, @Body(new ZodValidationPipe(assistantTurnSchema)) body: AssistantTurnInput): Promise<AssistantTurnDto> {
    return this.service.turn(auth, body);
  }
}
