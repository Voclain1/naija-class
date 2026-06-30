import { Module } from "@nestjs/common";

import { DiscountRulesController } from "./discount-rules.controller.js";
import { DiscountRuleService } from "./discount-rule.service.js";

@Module({
  controllers: [DiscountRulesController],
  providers: [DiscountRuleService],
  exports: [DiscountRuleService],
})
export class DiscountsModule {}
