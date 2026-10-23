#!/bin/bash
# First start of an empty data volume only (the image's initdb hook). The same
# split as docs/runbooks/neon-prod-setup.md §1a–1b, without Neon's
# neondb_owner in the middle; `postgres` is the superuser, used only by the
# restore and backup jobs. The database-level half is database-setup.sql.
set -euo pipefail
: "${SCHOOL_KIT_PASSWORD:?}" "${APP_USER_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v school_kit_pw="$SCHOOL_KIT_PASSWORD" -v app_user_pw="$APP_USER_PASSWORD" <<'SQL'
CREATE ROLE school_kit WITH LOGIN BYPASSRLS PASSWORD :'school_kit_pw';
CREATE ROLE app_user WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'app_user_pw';
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /usr/local/share/school-kit/database-setup.sql
