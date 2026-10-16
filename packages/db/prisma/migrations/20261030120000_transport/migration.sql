-- Phase 9 / CP5.2 — Transport (docs/modules/phase-9.md §13 CP5-D7/D8,
-- approved 2026-10-16).
--
-- Vehicles (plate, seats), drivers (name, phone, licence), routes with a fee
-- per term and ordered stops, and each student's place on one route and stop
-- per term. A place raises a TRANSPORT student charge at the route's fee —
-- through StudentChargeService only, never by a write here. A route takes no
-- more children in a term than its vehicle has seats; the service checks that
-- with the route row locked.
--
-- Drivers are records, not accounts: they never sign in. Pickup times are
-- minutes since midnight in the school's wall-clock time (CLAUDE.md).
--
-- Tenant data, RLS forced on every table. No SECURITY DEFINER function; the
-- count stays 23.

CREATE TABLE "transport_vehicles" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "description" TEXT,
    "seats" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transport_vehicles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transport_vehicles_plate" CHECK (char_length("plate") BETWEEN 1 AND 20 AND "plate" = upper("plate")),
    CONSTRAINT "transport_vehicles_description" CHECK ("description" IS NULL OR char_length("description") BETWEEN 1 AND 120),
    CONSTRAINT "transport_vehicles_seats" CHECK ("seats" BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX "transport_vehicles_school_id_plate_key" ON "transport_vehicles"("school_id", "plate");

CREATE TABLE "transport_drivers" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "licence_number" TEXT,
    "licence_expiry" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transport_drivers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transport_drivers_name" CHECK (char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "transport_drivers_phone" CHECK (char_length("phone") BETWEEN 7 AND 20),
    CONSTRAINT "transport_drivers_licence_number" CHECK ("licence_number" IS NULL OR char_length("licence_number") BETWEEN 1 AND 40)
);
CREATE INDEX "transport_drivers_school_id_idx" ON "transport_drivers"("school_id");

CREATE TABLE "transport_routes" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "driver_id" TEXT,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transport_routes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transport_routes_name" CHECK (char_length("name") BETWEEN 1 AND 80),
    -- ₦0 (free) to ₦10,000,000, the student-charge ceiling.
    CONSTRAINT "transport_routes_fee" CHECK ("fee" BETWEEN 0 AND 1000000000)
);
CREATE UNIQUE INDEX "transport_routes_school_id_name_key" ON "transport_routes"("school_id", "name");
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "transport_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "transport_stops" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "pickup_minute" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transport_stops_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transport_stops_name" CHECK (char_length("name") BETWEEN 1 AND 80),
    CONSTRAINT "transport_stops_position" CHECK ("position" >= 0),
    CONSTRAINT "transport_stops_pickup_minute" CHECK ("pickup_minute" IS NULL OR "pickup_minute" BETWEEN 0 AND 1439)
);
CREATE INDEX "transport_stops_route_id_position_idx" ON "transport_stops"("route_id", "position");
ALTER TABLE "transport_stops" ADD CONSTRAINT "transport_stops_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "transport_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "transport_assignments" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "stop_id" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transport_assignments_pkey" PRIMARY KEY ("id")
);
-- One route per student per term.
CREATE UNIQUE INDEX "transport_assignments_student_id_term_id_key" ON "transport_assignments"("student_id", "term_id");
CREATE INDEX "transport_assignments_school_id_route_id_term_id_idx" ON "transport_assignments"("school_id", "route_id", "term_id");
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "transport_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transport_assignments" ADD CONSTRAINT "transport_assignments_stop_id_fkey"
  FOREIGN KEY ("stop_id") REFERENCES "transport_stops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation, as on every tenant table.
ALTER TABLE "transport_vehicles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transport_vehicles" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transport_vehicles
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "transport_vehicles" TO app_user;

ALTER TABLE "transport_drivers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transport_drivers" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transport_drivers
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "transport_drivers" TO app_user;

ALTER TABLE "transport_routes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transport_routes" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transport_routes
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "transport_routes" TO app_user;

ALTER TABLE "transport_stops" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transport_stops" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transport_stops
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "transport_stops" TO app_user;

ALTER TABLE "transport_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transport_assignments" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transport_assignments
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "transport_assignments" TO app_user;


-- The two permissions (CP5-D11): read for admin and bursar, manage for admin.
-- Owner holds "*". Teachers get none. Idempotent, as earlier appends are.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["transport.read","transport.manage"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'admin' AND "is_system" = true;
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["transport.read"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'bursar' AND "is_system" = true;
