#!/usr/bin/env bash
# Prepares the CI PostgreSQL service the way production's initdb does, and PROVES it is the
# production major. Production runs PostgreSQL 18; a service image that silently resolved to another
# major would make every database test pass against the wrong server, so this fails loudly instead.
#   scripts/ci/db-init.sh [expected-major]      (default 18)
set -euo pipefail
want=${1:-18}
export PGPASSWORD=school_kit
psql_() { psql -h localhost -U school_kit -d school_kit -v ON_ERROR_STOP=1 "$@"; }
for _ in $(seq 1 30); do pg_isready -h localhost -U school_kit -d school_kit >/dev/null 2>&1 && break; sleep 1; done
have=$(psql_ -XqAt -c "SELECT current_setting('server_version_num')::int / 10000")
if [ "$have" != "$want" ]; then echo "::error::the CI database is PostgreSQL $have but production runs $want"; exit 1; fi
echo "PostgreSQL $have (matches production)"
psql_ -f infra/postgres/init/01-extensions.sql
psql_ -f infra/postgres/init/02-app-role.sql
