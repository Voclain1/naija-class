import { Module } from "@nestjs/common";

import { PaystackModule } from "../../common/paystack/paystack.module";
import { AuthModule } from "../auth/auth.module";
import { SchoolsController } from "./schools.controller";
import { SchoolsService } from "./schools.service";

@Module({
  // Imports AuthModule so the controller's @UseGuards(AuthGuard) can resolve
  // the guard via DI. The auth module already exports AuthGuard.
  // PaystackModule (2026-07-31) is needed so patchMe can eagerly verify a
  // pasted subaccount code via PaystackService.getSubaccount.
  imports: [AuthModule, PaystackModule],
  controllers: [SchoolsController],
  providers: [SchoolsService],
  exports: [SchoolsService],
})
export class SchoolsModule {}
