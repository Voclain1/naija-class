import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma } from "@school-kit/db";

// onModuleInit must never block NestFactory.create() indefinitely — a slow
// or saturated dev DB connection pool at startup previously produced a
// silent, unbounded hang (app.listen() never reached, no error, no crash;
// see docs/deferred.md's "recurring dev-server bootstrap hang" entry). This
// is a fixed ceiling on how long the startup partition check may take, not a
// tuned value — the monthly cron (createNextMonthPartitions) is the durable
// path; onModuleInit is a best-effort cold-start convenience on top of it.
const ON_MODULE_INIT_TIMEOUT_MS = 5000;

@Injectable()
export class PartitionService implements OnModuleInit {
  private readonly logger = new Logger(PartitionService.name);

  // On startup: ensure the current month and next 2 months always have a
  // named partition. Protects against cold-starts after a deployment gap
  // (e.g. app was down over a month boundary).
  //
  // Deliberately non-fatal: if the DB is slow/unreachable at boot, this logs
  // a warning and lets NestJS finish starting rather than hanging forever or
  // crashing the process. The @Cron job below retries monthly regardless, so
  // a school running through the current + next 2 months without this
  // startup check succeeding is the worst case, not data loss — a missing
  // partition only bites if a row is ever inserted for that unlisted month,
  // which create_audit_log_partition's caller (audit writes) would then
  // surface as a real, visible error, not a silent gap.
  async onModuleInit() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.ensurePartitionsForNextMonths(2),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${ON_MODULE_INIT_TIMEOUT_MS}ms`)),
            ON_MODULE_INIT_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`PartitionService.onModuleInit failed (non-fatal): ${message}`);
    } finally {
      clearTimeout(timer);
    }
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
