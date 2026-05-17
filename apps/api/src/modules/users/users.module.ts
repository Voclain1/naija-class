import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  // AuthModule exports AuthGuard so the controller's @UseGuards(AuthGuard)
  // can resolve it via DI. Same pattern as SchoolsModule.
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
