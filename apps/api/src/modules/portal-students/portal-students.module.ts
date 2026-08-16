import { Module } from "@nestjs/common";

import { PortalStudentsController } from "./portal-students.controller";
import { PortalStudentsService } from "./portal-students.service";
import { StudentAccessService } from "./student-access.service";

@Module({
  controllers: [PortalStudentsController],
  providers: [PortalStudentsService, StudentAccessService],
})
export class PortalStudentsModule {}
