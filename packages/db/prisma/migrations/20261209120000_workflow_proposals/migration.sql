-- Server-owned workflow proposals (docs/modules/student-intake-proposals.md).
-- A reviewed batch of operational work, confirmed by a person and executed
-- once. `payload` carries operational rows only until completion or expiry,
-- then is set NULL (data_cleared_at records when). No model or chat text.
CREATE TABLE "workflow_proposals" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "confirmed_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "client_request_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "preview_hash" TEXT NOT NULL,
    "payload" JSONB,
    "summary" JSONB NOT NULL,
    "result" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "data_cleared_at" TIMESTAMP(3),

    CONSTRAINT "workflow_proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workflow_proposals_status_check" CHECK ("status" IN ('PENDING', 'COMPLETED', 'EXPIRED')),
    CONSTRAINT "workflow_proposals_completed_check" CHECK (
      ("status" = 'COMPLETED') = ("result" IS NOT NULL AND "confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "workflow_proposals_client_request_key"
  ON "workflow_proposals"("school_id", "kind", "requested_by", "client_request_id");
CREATE INDEX "workflow_proposals_school_id_kind_created_at_idx"
  ON "workflow_proposals"("school_id", "kind", "created_at" DESC);

-- Tenant isolation, like every tenant table (policies/workflow-proposals.sql).
ALTER TABLE "workflow_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_proposals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "workflow_proposals"
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));
