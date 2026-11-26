import { InstallmentRequestsService } from "./installment-requests.service.js";
import { Module } from "@nestjs/common";

import { EmailModule } from "../../common/email/email.module.js";
import { MessagingWalletModule } from "../notifications/messaging/messaging-wallet.module";
import { PaidMessagingModule } from "../notifications/messaging/paid-messaging.module";
import { NotificationDispatchModule } from "../notifications/notification-dispatch.module";
import { PaystackModule } from "../../common/paystack/paystack.module.js";
import { PayrollModule } from "../payroll/payroll.module.js";
import { InvoicesModule } from "../invoices/invoices.module.js";
import { PaymentConfirmationService } from "./payment-confirmation.service.js";
import { PaymentPlanService } from "./payment-plan.service.js";
import { PaymentPlansController } from "./payment-plans.controller.js";
import { PaystackWebhookInboxService } from "./paystack-webhook-inbox.service.js";
import { PaystackController } from "./paystack.controller.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { RefundsController } from "./refunds.controller.js";
import { RefundsService } from "./refunds.service.js";

// StorageService is provided by the global StorageModule (registered in AppModule).
// PaystackService is provided by PaystackModule (imported below).
// No need to import StorageModule here — it is global.
//
// PayrollModule is imported so PaystackController can inject PayrollService
// to route transfer.* webhook events (CP4b). Directionally clean: PaymentsModule
// -> PayrollModule -> PaystackModule, no cycle.

@Module({
  imports: [PaystackModule, MessagingWalletModule, PaidMessagingModule, PayrollModule, InvoicesModule, NotificationDispatchModule, EmailModule],
  controllers: [PaymentsController, PaystackController, PaymentPlansController, RefundsController],
  providers: [InstallmentRequestsService, PaymentsService, PaymentPlanService, RefundsService, PaymentConfirmationService, PaystackWebhookInboxService],
  exports: [InstallmentRequestsService, PaymentsService, PaymentPlanService, RefundsService, PaystackWebhookInboxService],
})
export class PaymentsModule {}
