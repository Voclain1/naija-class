import { Module } from "@nestjs/common";

import { PartitionService } from "./partition.service.js";

@Module({
  providers: [PartitionService],
})
export class SystemModule {}
