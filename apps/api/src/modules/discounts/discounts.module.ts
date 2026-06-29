import { Module } from "@nestjs/common";

import { DiscountRuleService } from "./discount-rule.service.js";

@Module({
  providers: [DiscountRuleService],
  exports: [DiscountRuleService],
})
export class DiscountsModule {}
