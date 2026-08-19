import { Module } from "@nestjs/common";

import { PortalDevicesController, StudentDevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";

@Module({
  controllers: [PortalDevicesController, StudentDevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
