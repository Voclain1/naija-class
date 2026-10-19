import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { IdCardCheckController, IdCardsController, StudentIdCardController } from "./id-cards.controller.js";
import { IdCardsService } from "./id-cards.service.js";

// ID cards (docs/modules/id-cards-and-store.md §3).
@Module({
  imports: [AuthModule],
  controllers: [IdCardsController, StudentIdCardController, IdCardCheckController],
  providers: [IdCardsService],
  exports: [IdCardsService],
})
export class IdCardsModule {}
