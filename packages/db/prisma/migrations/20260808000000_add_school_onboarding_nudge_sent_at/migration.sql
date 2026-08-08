-- Onboarding-nudge email dedup flag. Stamped once by OnboardingNudgeService
-- after the first (and only, v1) nudge send attempt for a school that
-- finished the wizard but never returned — see schema.prisma's
-- School.onboardingNudgeSentAt header comment.
ALTER TABLE "schools" ADD COLUMN "onboarding_nudge_sent_at" TIMESTAMP(3);
