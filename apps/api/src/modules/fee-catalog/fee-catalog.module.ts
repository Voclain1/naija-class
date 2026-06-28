import { Module } from "@nestjs/common";

import { FeeCategoryService } from "./fee-category.service.js";
import { FeeItemService } from "./fee-item.service.js";

@Module({
  providers: [FeeCategoryService, FeeItemService],
  exports: [FeeCategoryService, FeeItemService],
})
export class FeeCatalogModule {}
