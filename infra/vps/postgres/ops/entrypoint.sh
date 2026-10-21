#!/bin/sh
# The `ops` service: nightly backups on a schedule. cron starts jobs with an
# empty environment, so the container's settings go to a root-only file the
# job scripts read.
set -eu
umask 077
: "${BACKUP_BUCKET:=}"
if [ -n "$BACKUP_BUCKET" ]; then
  # rclone and WAL-G share the one set of S3 credentials (backup.env).
  export RCLONE_CONFIG_BACKUP_TYPE=s3 RCLONE_CONFIG_BACKUP_PROVIDER=Other \
         RCLONE_CONFIG_BACKUP_ENV_AUTH=false \
         RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}" \
         RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}" \
         RCLONE_CONFIG_BACKUP_ENDPOINT="${AWS_ENDPOINT:-}" \
         RCLONE_CONFIG_BACKUP_REGION="${AWS_REGION:-}"
fi
export -p > /ops/env.sh
cat > /etc/cron.d/school-kit <<'CRON'
SHELL=/bin/sh
# 01:30 UTC = 02:30 Lagos, the quietest hour.
30 1 * * * root /ops/backup.sh >> /proc/1/fd/1 2>&1
CRON
chmod 0644 /etc/cron.d/school-kit
echo "ops: backups $( [ -n "$BACKUP_BUCKET" ] && echo "to $BACKUP_BUCKET" || echo "NOT CONFIGURED (backup.env)" )"
exec cron -f
