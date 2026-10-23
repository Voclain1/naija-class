# Postgres for School Kit on the VPS (docs/runbooks/vps-migration.md):
# pgvector, plus WAL-G for continuous WAL archiving (point-in-time restore)
# and the tools the `ops` service uses (cron, rclone, curl). The same image
# runs both services; only the command differs. Built on the server by
# docker compose.
ARG PG_MAJOR=16
FROM pgvector/pgvector:pg${PG_MAJOR}

ARG WALG_VERSION=v3.0.5
ADD --checksum=sha256:367ee2863f5f46fde8ab89ce289ca3a43fab3117f8d580029c502b0462580846 \
    https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-ubuntu-22.04-amd64.tar.gz /tmp/wal-g.tgz
RUN tar -xzf /tmp/wal-g.tgz -C /tmp \
 && install -m 0755 /tmp/wal-g-pg-ubuntu-22.04-amd64 /usr/local/bin/wal-g \
 && rm -f /tmp/wal-g* \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl rclone cron \
 && rm -rf /var/lib/apt/lists/*

COPY initdb/ /docker-entrypoint-initdb.d/
COPY database-setup.sql /usr/local/share/school-kit/database-setup.sql
COPY archive-wal.sh /usr/local/bin/archive-wal.sh
COPY ops/ /ops/
RUN chmod 0755 /usr/local/bin/archive-wal.sh /ops/*.sh
