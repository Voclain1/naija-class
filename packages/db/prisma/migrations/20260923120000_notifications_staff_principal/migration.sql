-- Notifications v1 (N2), part 1 of 2: the STAFF principal.
--
-- ON ITS OWN, deliberately. Postgres refuses to USE a new enum value in the
-- same transaction that adds it, and part 2 needs 'STAFF' inside a CHECK
-- constraint. Prisma runs each migration in its own transaction, so splitting
-- is what makes part 2 legal.
--
-- IF NOT EXISTS so a re-run is harmless: an enum label cannot be dropped, so
-- this is the one statement here that a rollback cannot undo.
ALTER TYPE "principal_type" ADD VALUE IF NOT EXISTS 'STAFF';
