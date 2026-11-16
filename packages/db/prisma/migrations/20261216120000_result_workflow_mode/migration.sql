ALTER TABLE "School"
ADD COLUMN "result_workflow_mode" TEXT NOT NULL DEFAULT 'CONTROLLED';

ALTER TABLE "School"
ADD CONSTRAINT "School_result_workflow_mode_check"
CHECK ("result_workflow_mode" IN ('SIMPLE', 'CONTROLLED'));
