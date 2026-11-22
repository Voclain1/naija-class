-- SchoolKit Assistant voice sessions (2026-11-21, docs/modules/assistant-voice.md).
-- Lifecycle, limits and metering only. No audio, transcript, reply text or
-- provider credential is ever stored here or anywhere else.

ALTER TABLE "schools" ADD COLUMN "voice_monthly_seconds_budget" INTEGER;
ALTER TABLE "schools" ADD CONSTRAINT "schools_voice_monthly_seconds_budget_check"
  CHECK ("voice_monthly_seconds_budget" IS NULL OR "voice_monthly_seconds_budget" >= 0);

CREATE TABLE "assistant_voice_sessions" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "provider" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,
    "credential_count" INTEGER NOT NULL DEFAULT 0,
    "turn_count" INTEGER NOT NULL DEFAULT 0,
    "interruption_count" INTEGER NOT NULL DEFAULT 0,
    "speech_characters" INTEGER NOT NULL DEFAULT 0,
    "billed_seconds" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_micro_usd" INTEGER NOT NULL DEFAULT 0,
    "recent_turn_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "assistant_voice_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assistant_voice_sessions_status_check" CHECK ("status" IN ('ACTIVE', 'ENDED')),
    CONSTRAINT "assistant_voice_sessions_end_reason_check" CHECK (
      "end_reason" IS NULL OR "end_reason" IN ('USER_ENDED', 'EXPIRED', 'IDLE', 'SUPERSEDED', 'REVOKED', 'ADMIN_ENDED', 'PROVIDER_FAILED')
    ),
    CONSTRAINT "assistant_voice_sessions_ended_check" CHECK (
      ("status" = 'ENDED') = ("ended_at" IS NOT NULL AND "end_reason" IS NOT NULL)
    ),
    CONSTRAINT "assistant_voice_sessions_counts_check" CHECK (
      "credential_count" >= 0 AND "turn_count" >= 0 AND "interruption_count" >= 0
      AND "speech_characters" >= 0 AND "billed_seconds" >= 0 AND "estimated_cost_micro_usd" >= 0
    )
);

CREATE INDEX "assistant_voice_sessions_school_id_status_idx" ON "assistant_voice_sessions"("school_id", "status");
CREATE INDEX "assistant_voice_sessions_school_id_started_at_idx" ON "assistant_voice_sessions"("school_id", "started_at" DESC);
CREATE INDEX "assistant_voice_sessions_school_id_user_id_status_idx" ON "assistant_voice_sessions"("school_id", "user_id", "status");

-- Tenant isolation, like every tenant table (policies/assistant-voice.sql).
ALTER TABLE "assistant_voice_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistant_voice_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assistant_voice_sessions"
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));
