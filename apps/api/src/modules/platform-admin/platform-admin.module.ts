import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminService } from "./platform-admin.service";

@Module({
  imports: [EmailModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
