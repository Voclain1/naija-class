#!/bin/bash
# Replaces the VPS database with a pg_dump (custom format) read from stdin.
# Run by vps-db-copy.yml for the rehearsal and, once, at cutover:
#   ssh vps /opt/school-kit/db-replace.sh [--no-start] < neon.dump
# --no-start leaves the apps stopped, so the copy can be compared with Neon
# before anything writes to it; `start-apps.sh` starts them.
#
# The restore runs as `postgres` with SET ROLE school_kit and --no-owner, so
# every table and SECURITY DEFINER function ends up owned by school_kit
# (security-definer-inventory.spec.ts requires it) without Neon's
# neondb_owner. The privileges in the dump (EXECUTE on the auth functions,
# app_user's grants) come across; database-setup.sql supplies what only the
# superuser can do here. Tested end to end, see docs/runbooks/vps-migration.md.
#
# --exit-on-error and --single-transaction: any error leaves an EMPTY
# database and the apps stopped, never a half-restored one. The only entries
# skipped are comments that need an owner other than school_kit and change
# nothing: the three COMMENT ON EXTENSION lines, and the empty COMMENT ON
# SCHEMA public that Neon's dumps carry (the schema belongs to the database
# owner, postgres).
set -euo pipefail
. "$(dirname "$0")/lib.sh"

echo "stopping the apps (no writes during the restore)"
compose stop api render-worker web portal cbt 2>/dev/null || compose stop api render-worker web portal

compose exec -T postgres sh -c 'cat > /tmp/import.dump'
compose exec -T postgres sh -c 'ls -l /tmp/import.dump'

compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "DROP DATABASE IF EXISTS school_kit WITH (FORCE)" -c "CREATE DATABASE school_kit"
compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U postgres -d school_kit \
  -f /usr/local/share/school-kit/database-setup.sql

compose exec -T postgres sh -c '
  set -e
  trap "rm -f /tmp/import.dump /tmp/import.toc" EXIT
  pg_restore -l /tmp/import.dump | grep -vE "COMMENT - (EXTENSION|SCHEMA public)" > /tmp/import.toc
  pg_restore -U postgres -d school_kit --no-owner --role=school_kit \
    --exit-on-error --single-transaction -L /tmp/import.toc /tmp/import.dump'
echo "restore ok"

# Jobs queued against the previous copy refer to rows that no longer exist.
compose exec -T redis redis-cli FLUSHALL

if [ "${1:-}" = "--no-start" ]; then
  echo "apps left stopped (--no-start)"
else
  compose up -d
  echo "apps started"
fi
