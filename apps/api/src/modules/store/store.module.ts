import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { InvoicesModule } from "../invoices/invoices.module.js";
import { StudentChargeService } from "../finance/student-charge.service.js";
import { AssetsService } from "./assets.service.js";
import { PortalStoreController } from "./portal-store.controller.js";
import { StoreOrdersService } from "./store-orders.service.js";
import { StorePricesService } from "./store-prices.service.js";
import { AssetsController, StoreController } from "./store.controller.js";
import { StoreService } from "./store.service.js";

// The Store and the fixed-assets register (docs/modules/id-cards-and-store.md §4).
@Module({
  imports: [AuthModule, InvoicesModule],
  controllers: [StoreController, AssetsController, PortalStoreController],
  providers: [StoreService, StoreOrdersService, AssetsService, StorePricesService, StudentChargeService],
})
export class StoreModule {}
