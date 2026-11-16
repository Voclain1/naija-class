ALTER TABLE "schools"
ADD COLUMN "result_workflow_mode" TEXT NOT NULL DEFAULT 'CONTROLLED';

ALTER TABLE "schools"
ADD CONSTRAINT "schools_result_workflow_mode_check"
CHECK ("result_workflow_mode" IN ('SIMPLE', 'CONTROLLED'));
