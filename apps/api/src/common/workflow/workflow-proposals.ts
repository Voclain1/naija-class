import type { PrismaClient } from "@school-kit/db";

/**
 * Marks a school's expired PENDING workflow proposals (every kind) EXPIRED and
 * clears their row data. Run by each workflow on touch and hourly by
 * WorkflowProposalsSweeperService. Metadata (ids, counts, outcome) is kept.
 */
export async function expireWorkflowProposals(db: PrismaClient, schoolId: string, now: Date = new Date(), kind?: string): Promise<number> {
  if (kind) {
    return db.$executeRaw`
      UPDATE workflow_proposals
         SET status = 'EXPIRED', payload = NULL, data_cleared_at = CURRENT_TIMESTAMP
       WHERE school_id = ${schoolId} AND kind = ${kind} AND status = 'PENDING' AND expires_at <= ${now}`;
  }
  return db.$executeRaw`
    UPDATE workflow_proposals
       SET status = 'EXPIRED', payload = NULL, data_cleared_at = CURRENT_TIMESTAMP
     WHERE school_id = ${schoolId} AND status = 'PENDING' AND expires_at <= ${now}`;
}
