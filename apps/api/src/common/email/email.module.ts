import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { EmailService } from "./email.service.js";

@Module({
  imports: [ConfigModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
