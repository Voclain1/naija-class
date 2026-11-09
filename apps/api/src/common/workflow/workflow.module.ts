import { Module } from "@nestjs/common";

import { WorkflowProposalsSweeperService } from "./workflow-proposals-sweeper.service";

/** Shared workflow-proposal housekeeping (no controllers, no model calls). */
@Module({ providers: [WorkflowProposalsSweeperService] })
export class WorkflowModule {}
