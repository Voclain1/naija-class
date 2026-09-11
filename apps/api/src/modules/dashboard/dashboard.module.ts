import { Module } from "@nestjs/common";

import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";

@Module({
  // FinanceModule is deliberately NOT imported. DashboardService used to
  // inject FinanceService and call getDashboard() from inside its own
  // withTenant — a nested transaction that deadlocked the connection pool in
  // production (2026-09-11). It now derives those figures through the pure
  // finance-totals.ts module instead, which needs no provider. Not importing
  // FinanceModule is what makes the nesting impossible to reintroduce by
  // accident rather than merely discouraged.
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
