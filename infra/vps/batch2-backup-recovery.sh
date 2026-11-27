#!/usr/bin/env bash
# Run on the approved VPS from the SchoolKit Compose directory, as the deploy operator.
set -Eeuo pipefail
umask 077
image=ghcr.io/voclain1/school-kit-postgres@sha256:1c0ac5407c14975abad8240218366477a6c2515c6d7fbc6a379a121577d4429d
mode=${1:?usage: bash batch2-backup-recovery.sh activate|verify-night}
[[ $mode == activate || $mode == verify-night ]]
test -r deploy.env && test -r backup.env && test -r docker-compose.yml
command -v flock >/dev/null
command -v python3 >/dev/null
exec 9> .batch2-backup.lock
flock -n 9
base=(docker compose --env-file deploy.env -f docker-compose.yml)
override=backup-ops.override.yml
compose=("${base[@]}" -f "$override")
stamp() { docker inspect -f '{{.Id}} {{.State.StartedAt}}' "$1"; }
pg=$("${base[@]}" ps -q postgres)
test -n "$pg"
baseline=$(stamp "$pg")
live_sql() { docker exec "$pg" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d school_kit -c "$1"; }
[[ $(live_sql 'SHOW server_version_num') =~ ^18[0-9]{4}$ ]]
processes() {
  local listing
  listing=$(docker top "$1" -eo pid,args)
  grep -Eq '^[[:space:]]*PID[[:space:]]+COMMAND' <<<"$listing"
  printf '%s\n' "$listing"
}
one_scheduler() {
  local listing
  listing=$(processes "$1") || return
  awk 'NR>1 && $2 ~ /(^|\/)cron$/ {n++} END {exit n!=1}' <<<"$listing"
}

if [[ $mode == verify-night ]]; then
  test -r "$override"
  test -r .batch2-postgres-identity
  test "$baseline" = "$(cat .batch2-postgres-identity)"
  new=$("${compose[@]}" ps -q ops-pinned)
  test -n "$new"
  test "$(docker inspect -f '{{.Config.Image}}' "$new")" = "$image"
  test -z "$("${base[@]}" ps -q ops)"
  one_scheduler "$new"
  startup=$(docker inspect -f '{{.State.StartedAt}}' "$new")
  docker exec -i -e SCHEDULER_STARTED_AT="$startup" "$new" sh -s <<'CHECK'
set -eu
. /ops/env.sh
test -n "${HEALTHCHECK_PING_URL:-}"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
folder="backup:${BACKUP_BUCKET}/dumps/daily"
rclone lsf --files-only "$folder" > "$scratch/list"
marker=$(grep -E '^school-kit-[0-9TZ:-]+\.dump\.sha256$' "$scratch/list" | sort | tail -1)
test -n "$marker"
# The current publisher uses UTC timestamps including seconds.
stamp=${marker#school-kit-}
stamp=${stamp%.dump.sha256}
test "${#stamp}" -eq 18
started=$(date -u -d "$SCHEDULER_STARTED_AT" +%Y-%m-%dT%H%M%SZ)
test "$(printf '%s\n' "$started" "$stamp" | sort | tail -1)" = "$stamp"
dump=${marker%.sha256}
rclone copyto "$folder/$marker" "$scratch/$marker"
rclone copyto "$folder/$dump" "$scratch/$dump"
cd "$scratch"
sha256sum -c "$marker"
pg_restore --list "$dump" >/dev/null
wal-g backup-list
CHECK
  docker logs --since "$startup" "$new" 2>&1 | grep -E 'dump started|dump ok:|base backup ok'
  echo 'Compare the new dump and base-backup timestamps with the 01:30 UTC cron run and confirm the same run in the heartbeat dashboard.'
  echo 'This check does not simulate a missed heartbeat or restore a new physical backup.'
  exit
fi

# Do not overwrite a prior rollout or mask an ambiguous Compose inventory.
test ! -e "$override"
test ! -e .batch2-postgres-identity
old=$("${base[@]}" ps -q ops)
test -n "$old"
old_policy=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$old")
[[ $old_policy == unless-stopped || $old_policy == always || $old_policy == no ]]
listing=$(processes "$old")
one_scheduler "$old"
# Idle means only cron is running. Do not kill a dump or WAL-G subprocess.
awk 'NR>1 {n++} END {exit n!=1}' <<<"$listing"
docker pull "$image"
image_id=$(docker image inspect -f '{{.Id}}' "$image")
test -n "$image_id"
# Local, tagged fallback, with the original container retained as additional evidence.
docker tag "$image" schoolkit-ops-fallback:batch2-verified
test "$(docker image inspect -f '{{.Id}}' schoolkit-ops-fallback:batch2-verified)" = "$image_id"
docker run --rm --network none --entrypoint sh schoolkit-ops-fallback:batch2-verified -ec '
  rclone version | grep -Fx "rclone v1.76.0"
  wal-g --version
  test -x /ops/entrypoint.sh
  test -x /ops/backup.sh
'

root=$(mktemp -d "$PWD/.batch2-pitr.XXXXXXXX")
fetch="schoolkit-pitr-fetch-$$"
recovery="schoolkit-pitr-recovery-$$"
network="schoolkit-pitr-egress-$$"
switched=0
cleanup() {
  local result=$?
  trap - EXIT
  set +e
  if docker inspect "$recovery" >/dev/null 2>&1; then docker rm -f "$recovery" >/dev/null || result=1; fi
  if docker inspect "$fetch" >/dev/null 2>&1; then docker rm -f "$fetch" >/dev/null || result=1; fi
  if docker network inspect "$network" >/dev/null 2>&1; then docker network rm "$network" >/dev/null || result=1; fi
  # Bind-mounted data may be owned by postgres. Remove it from a throwaway,
  # networkless container with only this mktemp directory mounted.
  docker run --rm --network none -v "$root:/scratch" --entrypoint sh "$image" \
    -ec 'find /scratch -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +' || result=1
  rmdir "$root" || result=1
  if [[ $result != 0 && $switched != 0 ]]; then
    echo 'Scheduler switch failed; attempting to stop replacement before restoring old scheduler.' >&2
    if [[ $switched == 1 ]] || "${compose[@]}" stop ops-pinned; then
      if stopped=$("${compose[@]}" ps -q ops-pinned) && [[ -z $stopped ]]; then
        docker update --restart="$old_policy" "$old" && docker start "$old" || echo 'Old scheduler could not restart; use the verified local fallback with the saved ops override.' >&2
      else
        echo 'Could not confirm replacement stopped. Do not start another scheduler.' >&2
      fi
    fi
  fi
  exit "$result"
}
trap cleanup EXIT

mkdir "$root/data" "$root/wal"
chmod 700 "$root" "$root/wal"
docker network create "$network" >/dev/null
# This fetch-only helper uses existing R2 configuration. It is not attached
# to a production application network and has no production volume.
docker run -d --name "$fetch" --network "$network" --env-file backup.env \
  -v "$root:/scratch" --entrypoint sleep "$image" infinity >/dev/null
docker exec "$fetch" sh -ec 'test -n "${WALG_S3_PREFIX:-}"; wal-g backup-list --json > /scratch/base.json'
base_name=$(python3 - "$root/base.json" <<'PY'
import json, re, sys
entries = json.load(open(sys.argv[1]))
# The accepted baseline has exactly one verified remote base. Stop if the
# inventory changed rather than choosing an unverified backup silently.
assert len(entries) == 1, "Expected exactly one previously verified base backup"
name = entries[0]["backup_name"]
assert re.fullmatch(r"base_[A-Za-z0-9_]+", name)
print(name)
PY
)
docker exec "$fetch" wal-g backup-fetch /scratch/data "$base_name"
first=$(docker exec "$fetch" sed -n 's/^START WAL LOCATION: .* (file \([0-9A-F]*\)).*/\1/p' /scratch/data/backup_label)
[[ $first =~ ^[0-9A-F]{24}$ ]]

# These write WAL restore records only. They do not modify application data.
tag=$(date -u +%Y%m%dT%H%M%SZ)_$$
target="batch2_target_$tag"
later="batch2_after_$tag"
target_lsn=$(live_sql "SELECT pg_create_restore_point('$target')")
later_lsn=$(live_sql "SELECT pg_create_restore_point('$later')")
last=$(live_sql "SELECT pg_walfile_name('$later_lsn'::pg_lsn)")
segment_size=$(live_sql "SELECT pg_size_bytes(current_setting('wal_segment_size'))")
live_sql 'SELECT pg_switch_wal()' >/dev/null
python3 - "$first" "$last" "$segment_size" > "$root/segments" <<'PY'
import re, sys
first, last, size = sys.argv[1:]
assert all(re.fullmatch(r"[0-9A-F]{24}", n) for n in (first, last))
assert first[:8] == last[:8], "Timeline changed; obtain a reviewed timeline-aware recovery plan"
per_log = (1 << 32) // int(size)
def ordinal(n):
    return int(n[8:16], 16) * per_log + int(n[16:], 16)
start, end = map(ordinal, (first, last))
assert 0 <= end - start < 256, "Unexpected WAL range; review capacity and base selection"
for n in range(start, end + 1):
    print(f"{first[:8]}{n // per_log:08X}{n % per_log:08X}")
PY
while read -r segment; do
  fetched=0
  for _ in {1..24}; do
    if docker exec "$fetch" timeout 30 wal-g wal-fetch "$segment" "/scratch/wal/$segment" >/dev/null 2>&1; then
      fetched=1
      break
    fi
    sleep 5
  done
  test "$fetched" = 1
  test "$(docker exec "$fetch" stat -c %s "/scratch/wal/$segment")" = "$segment_size"
done < "$root/segments"
docker rm -f "$fetch" >/dev/null
docker network rm "$network" >/dev/null

# Rebuild recovery configuration in the clone only. The restored process
# has neither R2 credentials nor any network interface beyond loopback.
printf 'local all postgres trust\n' > "$root/pg_hba.conf"
cat > "$root/recovery.conf" <<CONF
listen_addresses = ''
unix_socket_directories = '/tmp'
hba_file = '/scratch/pg_hba.conf'
archive_mode = off
archive_command = ''
primary_conninfo = ''
primary_slot_name = ''
restore_command = 'cp /scratch/wal/%f %p'
recovery_target_name = '$target'
recovery_target_timeline = 'current'
recovery_target_action = 'pause'
hot_standby = on
CONF
live_sql "SELECT name || ' = ' || setting FROM pg_settings WHERE name IN
('max_connections','max_worker_processes','max_wal_senders','max_prepared_transactions','max_locks_per_transaction')" >> "$root/recovery.conf"
chmod 644 "$root/pg_hba.conf" "$root/recovery.conf"
docker run --rm --network none -v "$root:/scratch" --entrypoint sh "$image" -ec '
  test ! -L /scratch/data/pg_wal
  test -z "$(find /scratch/data/pg_tblspc -mindepth 1 -print)"
  rm -f /scratch/data/standby.signal /scratch/data/postgresql.auto.conf /scratch/data/postmaster.pid
  touch /scratch/data/recovery.signal
  chmod 644 /scratch/wal/*
  chown -R postgres:postgres /scratch
  chmod 700 /scratch /scratch/data /scratch/wal
'
docker run -d --name "$recovery" --network none --user postgres \
  -v "$root:/scratch" --entrypoint postgres "$image" \
  -D /scratch/data -c config_file=/scratch/recovery.conf >/dev/null
clone_sql() { docker exec -u postgres "$recovery" psql -h /tmp -XqAt -v ON_ERROR_STOP=1 -U postgres -d school_kit -c "$1"; }
verified=0
for _ in {1..90}; do
  if result=$(clone_sql "SELECT pg_is_in_recovery() AND pg_get_wal_replay_pause_state()='paused'
    AND pg_last_wal_replay_lsn()>='$target_lsn'::pg_lsn
    AND pg_last_wal_replay_lsn()<'$later_lsn'::pg_lsn
    AND current_setting('archive_mode')='off'
    AND current_setting('listen_addresses')=''
    AND NOT EXISTS (SELECT 1 FROM pg_stat_wal_receiver)" 2>/dev/null) && [[ $result == t ]]; then
    verified=1
    break
  fi
  sleep 2
done
if [[ $verified != 1 ]]; then docker logs --tail 35 "$recovery" >&2; exit 1; fi
docker logs "$recovery" 2>&1 | grep -F "recovery stopping at restore point \"$target\""
printf 'PITR markers %s at %s, %s at %s, replay %s\n' "$target" "$target_lsn" "$later" "$later_lsn" "$(clone_sql 'SELECT pg_last_wal_replay_lsn()')"
clone_sql "SELECT 'schools', count(*) FROM schools UNION ALL SELECT 'students',count(*) FROM students
 UNION ALL SELECT 'invoices',count(*) FROM invoices UNION ALL SELECT 'payments',count(*) FROM payments"
migration_sql="SELECT count(*),count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
count(*) FILTER (WHERE rolled_back_at IS NOT NULL),count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
FROM _prisma_migrations"
restored_migrations=$(clone_sql "$migration_sql")
test "$restored_migrations" = "$(live_sql "$migration_sql")"
[[ $restored_migrations == *'|0' ]]
printf 'Migration history total|applied|rolled_back|unresolved = %s\n' "$restored_migrations"
docker rm -f "$recovery" >/dev/null

# Only activate after successful recovery. Keep the original container.
test "$baseline" = "$(stamp "$pg")"
listing=$(processes "$old")
one_scheduler "$old"
awk 'NR>1 {n++} END {exit n!=1}' <<<"$listing"
cat > "$override" <<YAML
services:
  ops-pinned:
    extends:
      file: docker-compose.yml
      service: ops
    image: $image
YAML
"${compose[@]}" config --quiet
switched=1
docker update --restart=no "$old" >/dev/null
docker stop "$old" >/dev/null
test "$(docker inspect -f '{{.State.Running}}' "$old")" = false
switched=2
"${compose[@]}" up -d --no-deps --no-build --pull never ops-pinned
new=$("${compose[@]}" ps -q ops-pinned)
test -n "$new"
for _ in {1..30}; do
  listing=$(processes "$new")
  if awk 'NR>1 && $2 ~ /(^|\/)cron$/ {n++} END {exit n!=1}' <<<"$listing"; then break; fi
  sleep 1
done
one_scheduler "$new"
docker exec "$new" sh -ec '
  test -s /ops/env.sh
  test -f /etc/cron.d/school-kit
  . /ops/env.sh
  test -n "${BACKUP_BUCKET:-}" && test -n "${WALG_S3_PREFIX:-}" && test -n "${HEALTHCHECK_PING_URL:-}"
  psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null
'
test "$baseline" = "$(stamp "$pg")"
printf '%s\n' "$baseline" > .batch2-postgres-identity
switched=0
echo 'Scheduler activated with old ops preserved and PostgreSQL identity unchanged. Run verify-night after the next 01:30 UTC cron window.'
