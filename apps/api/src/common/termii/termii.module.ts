import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { TermiiService } from "./termii.service.js";

@Module({
  imports: [ConfigModule],
  providers: [TermiiService],
  exports: [TermiiService],
})
export class TermiiModule {}
