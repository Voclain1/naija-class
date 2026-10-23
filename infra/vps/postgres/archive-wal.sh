#!/bin/sh
# Postgres archive_command (docker-compose.yml). Ships each finished WAL
# segment to object storage with WAL-G, which is what makes a restore to any
# minute possible. With no storage configured (WALG_S3_PREFIX unset) segments
# are let go, so a server without backups set up never fills its disk with WAL.
[ -n "${WALG_S3_PREFIX:-}" ] || exit 0
exec wal-g wal-push "$1"
