import { Module } from "@nestjs/common";

import { FeeCategoriesController } from "./fee-categories.controller.js";
import { FeeCategoryService } from "./fee-category.service.js";
import { FeeItemsController } from "./fee-items.controller.js";
import { FeeItemService } from "./fee-item.service.js";

@Module({
  controllers: [FeeCategoriesController, FeeItemsController],
  providers: [FeeCategoryService, FeeItemService],
  exports: [FeeCategoryService, FeeItemService],
})
export class FeeCatalogModule {}
