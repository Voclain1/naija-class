import { Module } from "@nestjs/common";

import { LoginLockoutService } from "../../common/auth/login-lockout";
import { AuthModule } from "../auth/auth.module";
import { ReleasedResultsService } from "../report-cards/released-results.service";
import { ResultCheckerController } from "./result-checker.controller";
import { ResultCheckerService } from "./result-checker.service";
import { ResultPinModule } from "./result-pin.module";
import { ResultPinsController } from "./result-pins.controller";

// Phase 8c / CP6b — the PIN batches (staff) and the public checker.
@Module({
  imports: [AuthModule, ResultPinModule],
  controllers: [ResultPinsController, ResultCheckerController],
  providers: [ResultCheckerService, ReleasedResultsService, LoginLockoutService],
})
export class ResultCheckerModule {}
