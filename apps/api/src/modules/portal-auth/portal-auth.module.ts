import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module.js";
import { PortalAuthController } from "./portal-auth.controller";
import { PortalAuthService } from "./portal-auth.service";

@Module({
  // EmailModule — forgot-password sends the reset link through the same
  // EmailService/Resend path guardian invites and staff resets already use.
  // RateLimitByEmailGuard needs REDIS_AUTH_CLIENT, but RedisAuthModule is
  // @Global() so it needs no import here.
  imports: [EmailModule],
  controllers: [PortalAuthController],
  providers: [PortalAuthService],
})
export class PortalAuthModule {}
