-- Phase 3 / Payroll CP4b — adds PROCESSING to PayrollStatus.
--
-- Set synchronously by PayrollService.transfer() right before calling
-- Paystack, and left in place until the transfer.success/failed/reversed
-- webhook resolves it to PAID or FAILED. This migration ONLY adds the enum
-- value — nothing else — because Postgres cannot use a newly-added enum
-- value in the same transaction that added it; keeping this migration to a
-- single ALTER TYPE statement avoids that restriction entirely rather than
-- working around it.
ALTER TYPE "PayrollStatus" ADD VALUE 'PROCESSING' AFTER 'APPROVED';
