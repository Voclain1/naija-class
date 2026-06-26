import { Module } from "@nestjs/common";

import { AuthGuard } from "../../common/auth/auth.guard";
import { RateLimitByEmailGuard } from "../../common/guards/rate-limit-by-email.guard";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  controllers: [AuthController],
  // AuthGuard is provided here (rather than as a global guard) so other
  // modules opt in explicitly via @UseGuards(AuthGuard). Phase 0 routes
  // outside /auth (signup is public; /health is public) intentionally have
  // no auth requirement yet.
  providers: [AuthService, AuthGuard, RateLimitByEmailGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
