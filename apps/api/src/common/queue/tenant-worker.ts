import type { Job } from "bullmq";

import { withTenant, type PrismaClient } from "@school-kit/db";

// tenantWorker — the single point of enforcement for the rule
// "every BullMQ processor MUST run under withTenant() before touching
// the DB".
//
// Why this exists: a processor runs OUTSIDE an HTTP request. There is
// no AuthGuard to set req.user.schoolId, no AsyncLocalStorage carrying
// tenancy, and Postgres' `app.current_school_id` GUC is unset on a
// fresh connection. If a processor called Prisma directly, FORCE RLS
// would already prevent reads (the policy's
// `current_setting('app.current_school_id', true)` returns NULL/empty,
// matching nothing) — but that's a fail-closed safety net, not a
// design pattern. We want every processor to establish tenant context
// affirmatively, and we want "forgot to do that" to be a single-helper
// problem, not a per-processor risk.
//
// The wrapper takes a processor function of shape (job, db) and returns
// a function of shape (job) that:
//   1. Asserts job.data.schoolId is present (refuses to run otherwise).
//   2. Calls withTenant(job.data.schoolId, db => processor(job, db)).
//
// withTenant() itself UUID-validates the schoolId, opens a Prisma
// transaction, and runs `SELECT set_config('app.current_school_id',
// $1, true)` before invoking the callback. By the time `processor`
// receives `db`, every policy on every RLS-protected table will read
// the GUC and apply the correct school filter.
//
// Usage:
//
//   @Processor(IMPORTS_QUEUE)
//   export class ImportsProcessor extends WorkerHost {
//     async process(job: Job): Promise<unknown> {
//       if (job.name === IMPORTS_JOB_VALIDATE) {
//         return this.handleValidate(job as Job<ValidateJobData>);
//       }
//       throw new Error(`unknown job name: ${job.name}`);
//     }
//
//     private handleValidate = tenantWorker<ValidateJobData, void>(
//       async (job, db) => {
//         // tenant context guaranteed; db is RLS-scoped to job.data.schoolId
//         await db.importJob.update({ ... });
//       },
//     );
//   }
//
// Companion lint rule: packages/config/eslint/base.js bans direct imports
// of `basePrisma` from anywhere outside packages/db/src/tenant-client.ts.
// That makes "skip withTenant and use the base client" a CI failure, not
// a runtime hope.

export type TenantJobData = {
  schoolId: string;
  userId: string;
  [k: string]: unknown;
};

export type TenantProcessor<D extends TenantJobData, R> = (
  job: Job<D>,
  db: PrismaClient,
) => Promise<R>;

export function tenantWorker<D extends TenantJobData, R>(
  processor: TenantProcessor<D, R>,
): (job: Job<D>) => Promise<R> {
  return async (job) => {
    if (!job.data || typeof job.data.schoolId !== "string" || job.data.schoolId.length === 0) {
      // We deliberately throw rather than no-op: a job with no schoolId
      // has no business existing. BullMQ will mark it failed and (after
      // retries exhausted) the FailedJobEvent listener picks it up. The
      // listener itself uses tenantWorker too — if schoolId is missing
      // from the failed job's data, even FAILED can't be written, which
      // is correct: a corrupted job MUST NOT influence any tenant's data.
      throw new Error(
        `tenantWorker: job ${job.id ?? "(no id)"} on queue '${
          job.queueName ?? "(unknown)"
        }' is missing schoolId in job.data — refusing to run`,
      );
    }
    return withTenant(job.data.schoolId, (db) => processor(job, db));
  };
}
