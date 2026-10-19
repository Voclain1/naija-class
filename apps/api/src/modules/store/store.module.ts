import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { StudentChargeService } from "../finance/student-charge.service.js";
import { AssetsService } from "./assets.service.js";
import { AssetsController, StoreController } from "./store.controller.js";
import { StoreService } from "./store.service.js";

// The Store and the fixed-assets register (docs/modules/id-cards-and-store.md §4).
@Module({
  imports: [AuthModule],
  controllers: [StoreController, AssetsController],
  providers: [StoreService, AssetsService, StudentChargeService],
})
export class StoreModule {}
