import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { PaystackModule } from "../../../common/paystack/paystack.module";
import { MessagingTopUpService } from "./messaging-top-up.service";

@Module({
  imports: [ConfigModule, PaystackModule],
  providers: [MessagingTopUpService],
  exports: [MessagingTopUpService],
})
export class MessagingWalletModule {}
