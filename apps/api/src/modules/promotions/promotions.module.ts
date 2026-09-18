import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PromotionsController } from "./promotions.controller";
import { PromotionsService } from "./promotions.service";

// Promotion engine (2026-09-17) — docs/modules/promotion-engine.md.
//
// Deliberately its own module rather than more surface on EnrollmentsModule:
// enrollments is a CRUD resource, this is a one-shot school-wide operation
// with its own permissions, its own audit action and its own safety rules.
@Module({
  imports: [AuthModule],
  controllers: [PromotionsController],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
