import { Module } from "@nestjs/common";

import { PartitionService } from "./partition.service.js";
import { SessionSweeperService } from "./session-sweeper.service.js";

@Module({
  providers: [PartitionService, SessionSweeperService],
})
export class SystemModule {}
