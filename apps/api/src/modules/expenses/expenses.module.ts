import { Module } from "@nestjs/common";

// StorageService is provided by the global StorageModule (registered in
// AppModule) — no need to import it here, same as PaymentsModule.

import { ExpenseCategoriesController } from "./expense-categories.controller.js";
import { ExpenseCategoryService } from "./expense-category.service.js";
import { ExpenseService } from "./expense.service.js";
import { ExpensesController } from "./expenses.controller.js";

@Module({
  controllers: [ExpenseCategoriesController, ExpensesController],
  providers: [ExpenseCategoryService, ExpenseService],
  exports: [ExpenseCategoryService, ExpenseService],
})
export class ExpensesModule {}
