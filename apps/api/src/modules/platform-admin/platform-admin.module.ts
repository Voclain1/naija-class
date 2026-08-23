import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module";
import { PaystackModule } from "../../common/paystack/paystack.module";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminService } from "./platform-admin.service";

@Module({
  imports: [EmailModule, PaystackModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
