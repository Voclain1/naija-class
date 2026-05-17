import { Module } from "@nestjs/common";

import { InvitationsController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";

// No AuthModule import: both invitation endpoints are public. The service
// uses createSession (a free function) and password (a free module), so
// nothing in this module's DI graph reaches into auth.
@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
