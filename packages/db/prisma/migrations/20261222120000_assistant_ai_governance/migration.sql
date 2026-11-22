-- SchoolKit Assistant AI governance (2026-11-22,
-- docs/modules/assistant-ai-governance.md): a school's data classification,
-- the platform's release decisions per data scope, and school owners' AI
-- terms decisions. No conversation content anywhere.

ALTER TABLE "schools" ADD COLUMN "ai_data_classification" TEXT NOT NULL DEFAULT 'LIVE';
ALTER TABLE "schools" ADD CONSTRAINT "schools_ai_data_classification_check"
  CHECK ("ai_data_classification" IN ('LIVE', 'FICTIONAL'));

-- Platform-level release decisions. No school_id: this is about the platform,
-- not a tenant, like `schools` itself (which has no RLS policy).
CREATE TABLE "ai_release_events" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requirement_id" TEXT,
    "requirements_version" TEXT NOT NULL,
    "statement_sha256" TEXT,
    "reference" TEXT NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_release_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_release_events_scope_check" CHECK ("scope" IN ('LIVE', 'FICTIONAL')),
    CONSTRAINT "ai_release_events_action_check" CHECK ("action" IN ('ATTEST', 'AUTHORISE', 'REVOKE')),
    CONSTRAINT "ai_release_events_attest_check" CHECK (
      ("action" = 'ATTEST') = ("requirement_id" IS NOT NULL AND "statement_sha256" IS NOT NULL)
    ),
    CONSTRAINT "ai_release_events_reference_check" CHECK (char_length("reference") BETWEEN 3 AND 300)
);
CREATE INDEX "ai_release_events_scope_recorded_at_idx" ON "ai_release_events"("scope", "recorded_at" DESC);

-- School owners' AI terms decisions, under FORCE RLS like every tenant table.
CREATE TABLE "school_ai_terms_events" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "wording_sha256" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_ai_terms_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "school_ai_terms_events_action_check" CHECK ("action" IN ('ACCEPT', 'WITHDRAW'))
);
CREATE INDEX "school_ai_terms_events_school_id_recorded_at_idx" ON "school_ai_terms_events"("school_id", "recorded_at" DESC);

ALTER TABLE "school_ai_terms_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_ai_terms_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "school_ai_terms_events"
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));

-- Append-only evidence: the runtime role may add and read, never change or
-- remove. School deletion runs as app_user under the school's own GUC and
-- deletes every school_id table, so school_ai_terms_events keeps DELETE.
REVOKE UPDATE, DELETE ON "ai_release_events" FROM app_user;
REVOKE UPDATE ON "school_ai_terms_events" FROM app_user;
