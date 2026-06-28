import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma } from "@school-kit/db";

@Injectable()
export class PartitionService implements OnModuleInit {
  private readonly logger = new Logger(PartitionService.name);

  // On startup: ensure the current month and next 2 months always have a
  // named partition. Protects against cold-starts after a deployment gap
  // (e.g. app was down over a month boundary).
  async onModuleInit() {
    await this.ensurePartitionsForNextMonths(2);
  }

  // Runs on the 20th of each month at midnight UTC. Creates the partition for
  // the month-after-next so there is always at least one pre-created partition
  // ahead of the current date.
  @Cron("0 0 20 * *")
  async createNextMonthPartitions() {
    await this.ensurePartitionsForNextMonths(2);
  }

  // Public for direct use in tests and in onModuleInit.
  async ensurePartitionsForNextMonths(count: number): Promise<void> {
    const now = new Date();
    for (let i = 0; i <= count; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      await this.ensurePartition(d.getFullYear(), d.getMonth() + 1);
    }
  }

  async ensurePartition(year: number, month: number): Promise<void> {
    // Delegates DDL to create_audit_log_partition(), a SECURITY DEFINER
    // function owned by the migration role (school_kit). app_user cannot
    // CREATE TABLE directly; calling a function is a plain SELECT that
    // app_user is permitted to execute.
    //
    // year/month are integer-typed parameters — the function body uses
    // integer arithmetic and %I quoting, so there is no injection surface.
    await basePrisma.$executeRaw`
      SELECT create_audit_log_partition(${year}::INT, ${month}::INT)
    `;

    const mm = String(month).padStart(2, "0");
    this.logger.debug(`Partition ensured: audit_logs_${year}_${mm}`);
  }
}
