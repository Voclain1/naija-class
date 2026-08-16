import { Module } from "@nestjs/common";

import { StudentPortalController } from "./student-portal.controller";
import { StudentPortalService } from "./student-portal.service";

@Module({
  controllers: [StudentPortalController],
  providers: [StudentPortalService],
})
export class StudentPortalModule {}
