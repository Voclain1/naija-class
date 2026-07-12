-- Adds ON DELETE CASCADE to users.school_id -> schools.id.
--
-- Root cause of the 54,106-school dev-DB accumulation found during Payroll
-- CP4b's manual gate (2026-07-12, see docs/deferred.md): this FK was plain
-- RESTRICT, so every spec file's
-- afterAll(() => basePrisma.school.delete(...).catch(() => undefined))
-- silently failed on the FK violation instead of actually deleting the
-- school. Schema-only change — no data migration needed, since this only
-- affects future deletes. Existing orphaned rows were pruned separately
-- (ad hoc, not via migration) as part of the same investigation.
ALTER TABLE "users" DROP CONSTRAINT "users_school_id_fkey";
ALTER TABLE "users" ADD CONSTRAINT "users_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
