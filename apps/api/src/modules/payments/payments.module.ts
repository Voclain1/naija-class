import { Module } from "@nestjs/common";

import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";

// StorageService is provided by the global StorageModule (registered in AppModule).
// No need to import StorageModule here.

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
