-- Durable fee reminder campaigns (docs/modules/reminder-campaigns.md).
-- A campaign is created by confirming a reviewed workflow_proposals row
-- (kind 'fee-reminder-campaign'). Its sends are an outbox: one row per
-- student, guardian and channel slot, fixed at confirmation. The rows hold
-- ids and states only: no contact detail, message text or amount.
CREATE TABLE "reminder_campaigns" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "confirmed_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "halt_reason" TEXT,
    "template_version" TEXT NOT NULL,
    "include_payment_plans" BOOLEAN NOT NULL,
    "overdue_only" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "halted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "reminder_campaigns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reminder_campaigns_status_check" CHECK ("status" IN ('RUNNING', 'HALTED', 'COMPLETED')),
    CONSTRAINT "reminder_campaigns_halt_check" CHECK (("status" = 'HALTED') = ("halt_reason" IS NOT NULL))
);
CREATE UNIQUE INDEX "reminder_campaigns_proposal_id_key" ON "reminder_campaigns"("proposal_id");
CREATE INDEX "reminder_campaigns_school_id_status_idx" ON "reminder_campaigns"("school_id", "status");

CREATE TABLE "reminder_campaign_sends" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channel_used" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "claim_token" TEXT,
    "claimed_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "provider_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_campaign_sends_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reminder_campaign_sends_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "reminder_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "reminder_campaign_sends_channel_check" CHECK ("channel" IN ('EMAIL', 'MOBILE')),
    CONSTRAINT "reminder_campaign_sends_channel_used_check" CHECK ("channel_used" IS NULL OR "channel_used" IN ('EMAIL', 'PUSH', 'SMS')),
    CONSTRAINT "reminder_campaign_sends_status_check" CHECK ("status" IN ('PENDING', 'SENDING', 'ACCEPTED', 'SKIPPED', 'FAILED', 'UNKNOWN')),
    CONSTRAINT "reminder_campaign_sends_claim_check" CHECK ("status" <> 'SENDING' OR ("claim_token" IS NOT NULL AND "claimed_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "reminder_campaign_sends_slot_key" ON "reminder_campaign_sends"("campaign_id", "student_id", "channel", "guardian_id");
CREATE INDEX "reminder_campaign_sends_school_id_campaign_id_status_idx" ON "reminder_campaign_sends"("school_id", "campaign_id", "status");

-- Tenant isolation, like every tenant table (policies/reminder-campaigns.sql).
ALTER TABLE "reminder_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reminder_campaigns" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reminder_campaigns"
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));

ALTER TABLE "reminder_campaign_sends" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reminder_campaign_sends" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reminder_campaign_sends"
  USING (school_id = current_setting('app.current_school_id', true))
  WITH CHECK (school_id = current_setting('app.current_school_id', true));
