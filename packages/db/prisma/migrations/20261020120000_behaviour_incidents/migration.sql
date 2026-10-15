-- Phase 9 / CP2.2 — behaviour incidents (docs/modules/phase-9.md §9 CP2-D2).
--
-- An incident groups the CONCERN records of several students: each student
-- gets their own `behaviour_records` row linked here, so their history stays
-- complete. Witnesses are staff users, chosen from a list.
--
-- Both tables are tenant data, ENABLE + FORCE RLS like `behaviour_records`.
-- No new permission (writing an incident is `behaviour.create`, reading is
-- `behaviour.read`). No SECURITY DEFINER function; the count stays 23.

-- CreateTable
CREATE TABLE "behaviour_incidents" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "occurred_on" DATE NOT NULL,
    "place" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recorded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMP(3),
    "withdrawn_by" TEXT,

    CONSTRAINT "behaviour_incidents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "behaviour_incidents_place_length" CHECK (char_length("place") BETWEEN 1 AND 120),
    CONSTRAINT "behaviour_incidents_description_length" CHECK (char_length("description") BETWEEN 1 AND 1000)
);

-- CreateTable
CREATE TABLE "behaviour_incident_witnesses" (
    "incident_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,

    CONSTRAINT "behaviour_incident_witnesses_pkey" PRIMARY KEY ("incident_id","user_id")
);

-- CreateIndex
CREATE INDEX "behaviour_incidents_school_id_occurred_on_idx" ON "behaviour_incidents"("school_id", "occurred_on");

-- AlterTable
ALTER TABLE "behaviour_records" ADD COLUMN "incident_id" TEXT;

-- CreateIndex
CREATE INDEX "behaviour_records_incident_id_idx" ON "behaviour_records"("incident_id");

-- AddForeignKey
ALTER TABLE "behaviour_records" ADD CONSTRAINT "behaviour_records_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "behaviour_incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behaviour_incident_witnesses" ADD CONSTRAINT "behaviour_incident_witnesses_incident_id_fkey"
  FOREIGN KEY ("incident_id") REFERENCES "behaviour_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "behaviour_incidents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "behaviour_incidents" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON behaviour_incidents
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "behaviour_incidents" TO app_user;

ALTER TABLE "behaviour_incident_witnesses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "behaviour_incident_witnesses" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON behaviour_incident_witnesses
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "behaviour_incident_witnesses" TO app_user;
