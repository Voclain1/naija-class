import { Module } from "@nestjs/common";

import {
  PortalDevicesController,
  StaffDevicesController,
  StudentDevicesController,
} from "./devices.controller";
import { DevicesService } from "./devices.service";

@Module({
  controllers: [PortalDevicesController, StudentDevicesController, StaffDevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
