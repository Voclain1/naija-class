import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AuthModule } from "../auth/auth.module";
import { BvnController } from "./bvn.controller";
import { BvnService } from "./bvn.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  // AuthModule exports AuthGuard so the controller's @UseGuards(AuthGuard)
  // can resolve it via DI. ConfigModule is needed by BvnService
  // (BVN_ENCRYPTION_KEY) — imported here directly (not relying on a global
  // registration existing) so UsersModule resolves standalone in narrow
  // test bootstraps too. Same pattern as PaystackModule/PaymentsModule.
  imports: [AuthModule, ConfigModule],
  controllers: [UsersController, BvnController],
  providers: [UsersService, BvnService],
  exports: [UsersService, BvnService],
})
export class UsersModule {}
