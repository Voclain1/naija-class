import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module";
import { PaystackModule } from "../../common/paystack/paystack.module";
import { AuthModule } from "../auth/auth.module";
import { PaystackSetupService } from "./paystack-setup.service";
import { SchoolsController } from "./schools.controller";
import { SchoolsService } from "./schools.service";

@Module({
  // Imports AuthModule so the controller's @UseGuards(AuthGuard) can resolve
  // the guard via DI. The auth module already exports AuthGuard.
  // PaystackModule (2026-07-31) is needed so patchMe can eagerly verify a
  // pasted subaccount code via PaystackService.getSubaccount.
  // EmailModule (2026-08-15) is needed by PaystackSetupService to notify the
  // platform operator that a school is waiting on a subaccount.
  imports: [AuthModule, PaystackModule, EmailModule],
  controllers: [SchoolsController],
  providers: [SchoolsService, PaystackSetupService],
  exports: [SchoolsService],
})
export class SchoolsModule {}
