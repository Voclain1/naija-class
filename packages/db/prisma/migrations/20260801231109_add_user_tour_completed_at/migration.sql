-- First-login product tour (owner/admin shell). Null until finished/skipped;
-- either action stamps "now" — see schema.prisma's User.tourCompletedAt
-- header comment for the no-separate-skipped-state rationale.
ALTER TABLE "users" ADD COLUMN "tour_completed_at" TIMESTAMP(3);
