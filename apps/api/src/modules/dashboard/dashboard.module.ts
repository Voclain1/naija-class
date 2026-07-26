import { Module } from "@nestjs/common";

import { FinanceModule } from "../finance/finance.module.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";

@Module({
  // DashboardService composes FinanceService.getDashboard() rather than
  // re-deriving fee/outstanding numbers — see dashboard.service.ts header.
  imports: [FinanceModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
