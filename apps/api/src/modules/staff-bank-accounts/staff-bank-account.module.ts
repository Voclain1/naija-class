import { Module } from "@nestjs/common";

import { PaystackModule } from "../../common/paystack/paystack.module.js";
import { StaffBankAccountController } from "./staff-bank-account.controller.js";
import { StaffBankAccountService } from "./staff-bank-account.service.js";

@Module({
  imports: [PaystackModule],
  controllers: [StaffBankAccountController],
  providers: [StaffBankAccountService],
  exports: [StaffBankAccountService],
})
export class StaffBankAccountModule {}
