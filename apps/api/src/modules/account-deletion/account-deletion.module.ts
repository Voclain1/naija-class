import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import {
  AccountDeletionRequestsController,
  GuardianAccountDeletionController,
  StaffAccountDeletionController,
  StudentAccountDeletionController,
} from "./account-deletion.controller.js";
import { AccountDeletionService } from "./account-deletion.service.js";

// Account deletion requests (docs/modules/account-deletion-requests.md).
@Module({
  imports: [AuthModule],
  controllers: [
    StaffAccountDeletionController,
    GuardianAccountDeletionController,
    StudentAccountDeletionController,
    AccountDeletionRequestsController,
  ],
  providers: [AccountDeletionService],
})
export class AccountDeletionModule {}
