import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { GuardianConsentController, SchoolDataProtectionController } from "./data-protection.controller.js";
import { DataProtectionService } from "./data-protection.service.js";

// Data protection consent (docs/modules/data-protection.md).
@Module({
  imports: [AuthModule],
  controllers: [SchoolDataProtectionController, GuardianConsentController],
  providers: [DataProtectionService],
})
export class DataProtectionModule {}
