import { Module } from "@nestjs/common";

import { PortalStudentsController } from "./portal-students.controller";
import { PortalStudentsService } from "./portal-students.service";

@Module({
  controllers: [PortalStudentsController],
  providers: [PortalStudentsService],
})
export class PortalStudentsModule {}
