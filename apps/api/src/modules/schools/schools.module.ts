import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { SchoolsController } from "./schools.controller";
import { SchoolsService } from "./schools.service";

@Module({
  // Imports AuthModule so the controller's @UseGuards(AuthGuard) can resolve
  // the guard via DI. The auth module already exports AuthGuard.
  imports: [AuthModule],
  controllers: [SchoolsController],
  providers: [SchoolsService],
  exports: [SchoolsService],
})
export class SchoolsModule {}
