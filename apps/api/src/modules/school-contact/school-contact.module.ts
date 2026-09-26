import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import {
  PortalSchoolContactController,
  StudentSchoolContactController,
} from "./school-contact.controller";
import { SchoolContactService } from "./school-contact.service";

// Part D's one server addition: the school's own name and number, for the
// "Call the school" button (docs/modules/the-school-day.md D12).
@Module({
  imports: [AuthModule],
  controllers: [PortalSchoolContactController, StudentSchoolContactController],
  providers: [SchoolContactService],
  exports: [SchoolContactService],
})
export class SchoolContactModule {}
