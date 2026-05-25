import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { GuardiansController } from "./guardians.controller";
import { GuardiansService } from "./guardians.service";

@Module({
  imports: [AuthModule],
  controllers: [GuardiansController],
  providers: [GuardiansService],
  exports: [GuardiansService],
})
export class GuardiansModule {}
