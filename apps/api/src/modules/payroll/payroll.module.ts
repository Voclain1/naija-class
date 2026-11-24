import { Module } from "@nestjs/common";

// Import storage explicitly: PayrollModule is also reached from PaymentsModule
// in isolated platform-admin applications that do not import AppModule.
import { PaystackModule } from "../../common/paystack/paystack.module.js";
import { StorageModule } from "../../common/storage/storage.module.js";
import { PayrollController } from "./payroll.controller.js";
import { PayrollService } from "./payroll.service.js";

@Module({
  imports: [PaystackModule, StorageModule],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
