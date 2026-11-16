-- A browser retry after a lost POST /students response must return the row
-- already created by that form, not create a second child. Nullable keeps all
-- existing rows and non-form import paths backward-compatible.
ALTER TABLE "students" ADD COLUMN "creation_request_id" TEXT;

CREATE UNIQUE INDEX "students_school_id_creation_request_id_key"
  ON "students"("school_id", "creation_request_id");
