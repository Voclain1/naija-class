-- School web addresses (2026-10-22, docs/modules/school-addresses.md).
--
-- A school's address is schools.slug: "<code>.schoolkit.ng", and the school
-- code students type to sign in. A school may now change it, within limits.
-- The code is printed on result PIN cards, shared in admission links, kept on
-- students' phones and inside offline exam packs, so the OLD code must keep
-- working forever and must never pass to another school. This table holds
-- every school's earlier codes.
--
-- No SECURITY DEFINER function is added or changed. Student sign-in resolves an
-- old code to the current one in the service, then calls
-- auth_lookup_student_for_login with the current code, unchanged.

CREATE TABLE "school_previous_addresses" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "retired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_by" TEXT,
    "counts_toward_limit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "school_previous_addresses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "school_previous_addresses_slug_key" ON "school_previous_addresses"("slug");
CREATE INDEX "school_previous_addresses_school_id_retired_at_idx" ON "school_previous_addresses"("school_id", "retired_at");

ALTER TABLE "school_previous_addresses" ADD CONSTRAINT "school_previous_addresses_school_id_fkey"
    FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One code, one school, past or present. The unique indexes keep codes unique
-- within each table; these two triggers keep them apart ACROSS the tables, so
-- a school can never take another school's old code, and a code can never be
-- retired while another school holds it. Ordinary (invoker) functions: they
-- only read, and both tables are readable by app_user (schools has no RLS; the
-- history table has a read-all policy below). The service also serialises
-- every address change behind one advisory lock; these are the backstop.
CREATE OR REPLACE FUNCTION school_slug_not_retired_elsewhere() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM school_previous_addresses
    WHERE slug = NEW.slug AND school_id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'school address % belonged to another school', NEW.slug
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER schools_slug_not_retired_elsewhere
  BEFORE INSERT OR UPDATE OF slug ON "schools"
  FOR EACH ROW EXECUTE FUNCTION school_slug_not_retired_elsewhere();

CREATE OR REPLACE FUNCTION school_previous_slug_not_current_elsewhere() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM schools
    WHERE slug = NEW.slug AND id <> NEW.school_id
  ) THEN
    RAISE EXCEPTION 'school address % belongs to another school', NEW.slug
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER school_previous_addresses_not_current_elsewhere
  BEFORE INSERT OR UPDATE OF slug ON "school_previous_addresses"
  FOR EACH ROW EXECUTE FUNCTION school_previous_slug_not_current_elsewhere();

-- RLS (copied verbatim to policies/school-addresses.sql). Read by everyone,
-- because public pages resolve a code before any school is known, and codes
-- are public anyway. Written only under the school's own GUC: a buggy service
-- cannot retire, or delete, another school's code. Rows are never edited.
ALTER TABLE "school_previous_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_previous_addresses" FORCE  ROW LEVEL SECURITY;

CREATE POLICY school_previous_addresses_read_all ON school_previous_addresses
  FOR SELECT
  USING (true);

CREATE POLICY school_previous_addresses_insert_own ON school_previous_addresses
  FOR INSERT
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY school_previous_addresses_delete_own ON school_previous_addresses
  FOR DELETE
  USING (school_id::text = current_setting('app.current_school_id', true));

REVOKE UPDATE ON "school_previous_addresses" FROM app_user;
