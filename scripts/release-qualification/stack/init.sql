-- Roles of the real deployment (fictional passwords), created when the stack's PostgreSQL first starts.
CREATE ROLE school_kit LOGIN SUPERUSER PASSWORD 'qual-migration-role';
CREATE ROLE app_user LOGIN PASSWORD 'qual-runtime-role' NOSUPERUSER NOBYPASSRLS;
