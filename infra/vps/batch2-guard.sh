#!/usr/bin/env bash
# Batch 2/3 operator guard. Run on the VPS from /opt/school-kit as the deploy
# operator. Every mode except `rotate-ping` is READ-ONLY. No mode prints a
# secret value, restarts PostgreSQL, or runs a backup. Output is safe to save.
#   bash batch2-guard.sh retention        retention + marker/dump consistency
#   bash batch2-guard.sh config           redacted backup.env inventory
#   bash batch2-guard.sh scheduler        ops-pinned persistence evidence
#   bash batch2-guard.sh deploy-preflight Batch 3 host preconditions
#   bash batch2-guard.sh rotate-ping      WRITE: replace the heartbeat URL
set -Eeuo pipefail
umask 077
mode=${1:?usage: batch2-guard.sh retention|config|scheduler|deploy-preflight|rotate-ping}
PINNED=ghcr.io/voclain1/school-kit-postgres@sha256:1c0ac5407c14975abad8240218366477a6c2515c6d7fbc6a379a121577d4429d
cd /opt/school-kit
base=(docker compose --env-file deploy.env -f docker-compose.yml)
compose=("${base[@]}" -f backup-ops.override.yml)
bad=0
ok()   { echo "PASS $*"; }
bad()  { echo "FAIL $*"; bad=1; }
info() { echo "INFO $*"; }
pinned_id() { "${compose[@]}" ps -q ops-pinned; }

case $mode in
retention)
  new=$(pinned_id); [ -n "$new" ] || { echo "BLOCK ops-pinned is not running"; exit 1; }
  # Runs inside the scheduler container, with its own credentials. Lists,
  # dry-runs and downloads to a scratch dir only. Nothing is deleted.
  docker exec -i "$new" sh -s <<'IN' || bad=1
set -eu
. /ops/env.sh
s=$(mktemp -d); trap 'rm -rf "$s"' EXIT
for f in daily weekly; do
  rclone lsf --files-only "backup:${BACKUP_BUCKET}/dumps/$f" > "$s/$f" 2>/dev/null || : > "$s/$f"
  d=$(grep -cE '^school-kit-[0-9TZ-]+\.dump$' "$s/$f" || true)
  m=$(grep -cE '^school-kit-[0-9TZ-]+\.dump\.sha256$' "$s/$f" || true)
  other=$(grep -vcE '^school-kit-[0-9TZ-]+\.dump(\.sha256)?$' "$s/$f" || true)
  echo "INFO $f: dumps=$d markers=$m unexpected-files=$other"
  # Pairing: a dump without a marker is not a valid backup; a marker without
  # a dump is the harmless 15-day/57-day boundary artefact.
  grep -E '\.dump$' "$s/$f" | while read -r x; do grep -qx "$x.sha256" "$s/$f" || echo "FAIL $f: dump without marker: $x"; done
  grep -E '\.dump\.sha256$' "$s/$f" | while read -r x; do grep -qx "${x%.sha256}" "$s/$f" || echo "INFO $f: marker without dump (boundary artefact): $x"; done
done
# Dry run only: shows what tonight's prune WOULD delete. --dry-run deletes nothing.
for pair in "daily 15d" "weekly 57d"; do set -- $pair
  n=$(rclone delete --dry-run --min-age "$2" "backup:${BACKUP_BUCKET}/dumps/$1" 2>&1 | grep -c 'Skipped delete' || true)
  echo "INFO $1: files the next prune would delete (age >$2, dry run): $n"
done
# Newest pair: independent checksum.
m=$(grep -E '\.dump\.sha256$' "$s/daily" | sort | tail -1); d=${m%.sha256}
rclone copyto "backup:${BACKUP_BUCKET}/dumps/daily/$m" "$s/$m"; rclone copyto "backup:${BACKUP_BUCKET}/dumps/daily/$d" "$s/$d"
( cd "$s" && sha256sum -c "$m" >/dev/null ) && echo "PASS newest daily pair checksum verified: $d" || echo "FAIL newest daily pair checksum"
echo "INFO WAL-G base backups:"; wal-g backup-list --detail 2>&1 | sed 's/^/  /' | head -20
# No --confirm: WAL-G prints what it WOULD delete and deletes nothing.
echo "INFO WAL-G retain FULL 7, DRY RUN (no --confirm):"; wal-g delete retain FULL 7 2>&1 | sed 's/^/  /' | head -20
echo "INFO WAL-G integrity (read-only):"; wal-g wal-verify integrity timeline 2>&1 | sed 's/^/  /' | head -20
IN
  docker exec "$("${base[@]}" ps -q postgres)" psql -XqAt -U postgres -d school_kit -c \
    "SELECT 'INFO pg_stat_archiver archived='||archived_count||' failed='||failed_count||' last_archived='||coalesce(last_archived_time::text,'never')||' last_failed='||coalesce(last_failed_time::text,'never') FROM pg_stat_archiver" ;;

config)
  f=backup.env; [ -r "$f" ] || { echo "BLOCK $f unreadable"; exit 1; }
  info "owner/mode/mtime: $(stat -c '%U:%G %a %y' "$f")"
  [ "$(stat -c %a "$f")" = 600 ] && ok "mode 0600" || bad "mode is not 0600"
  info "file sha256 (of the whole file, for change detection only): $(sha256sum "$f" | cut -c1-16)"
  python3 - "$f" <<'PY' || bad=1
import re, sys
req = ["BACKUP_BUCKET","WALG_S3_PREFIX","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_ENDPOINT","HEALTHCHECK_PING_URL"]
seen, rc = {}, 0
for n, line in enumerate(open(sys.argv[1], newline=""), 1):
    raw = line.rstrip("\n")
    if not raw.strip() or raw.lstrip().startswith("#"): continue
    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", raw)
    if not m: print(f"FAIL line {n}: not KEY=VALUE (content withheld)"); rc = 1; continue
    k, v = m.groups()
    if k in seen: print(f"FAIL duplicate key {k}"); rc = 1
    flags = []
    if v.endswith("\r"): flags.append("CRLF")
    if v != v.strip(): flags.append("surrounding-whitespace")
    if v[:1] in "\"'": flags.append("quoted(literal quotes under docker run --env-file)")
    if v == "": flags.append("EMPTY")
    seen[k] = 1
    print(f"INFO {k}: length={len(v)} {' '.join(flags)}".rstrip())
for k in req:
    print(("PASS present " if k in seen else "FAIL missing ") + k); rc |= k not in seen
sys.exit(rc)
PY
  info "compare with GitHub BACKUP_ENV_FILE only through the redacted PR job (docs/runbooks/batch2-acceptance-and-batch3.md §3)" ;;

scheduler)
  pg=$("${base[@]}" ps -q postgres); new=$(pinned_id); old=$("${base[@]}" ps -aq ops)
  [ -r backup-ops.override.yml ] && ok "override file present" || bad "override file missing"
  [ -r .batch2-postgres-identity ] && ok "postgres identity record present" || bad "identity record missing"
  [ "$(docker inspect -f '{{.Id}} {{.State.StartedAt}}' "$pg")" = "$(cat .batch2-postgres-identity)" ] \
    && ok "PostgreSQL identity and start time unchanged since activation" || bad "PostgreSQL was recreated or restarted since activation"
  [ -n "$new" ] && [ "$(docker inspect -f '{{.Config.Image}}' "$new")" = "$PINNED" ] && ok "ops-pinned runs the pinned digest" || bad "ops-pinned missing or not the pinned digest"
  [ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$new")" = unless-stopped ] && ok "ops-pinned restart policy unless-stopped (survives reboot)" || bad "ops-pinned restart policy"
  if [ -n "$old" ]; then
    [ "$(docker inspect -f '{{.State.Running}}' "$old")" = false ] && ok "original ops retained and STOPPED" || bad "original ops is RUNNING (two schedulers)"
    [ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$old")" = no ] && ok "original ops restart policy 'no'" || bad "original ops would restart"
  else bad "original ops container no longer exists (retained fallback lost)"; fi
  n=$(docker top "$new" -eo args | awk '$1 ~ /(^|\/)cron$/' | wc -l); [ "$n" = 1 ] && ok "exactly one cron in ops-pinned" || bad "cron count in ops-pinned is $n"
  docker image inspect schoolkit-ops-fallback:batch2-verified >/dev/null 2>&1 && ok "local fallback tag present" || bad "fallback tag schoolkit-ops-fallback:batch2-verified missing"
  docker image inspect "$PINNED" >/dev/null 2>&1 && ok "pinned digest image present locally" || bad "pinned digest image absent locally"
  # Static review of what future deploys would do:
  if grep -qE 'remove-orphans|image prune|system prune|up -d --build' deploy.sh 2>/dev/null; then
    info "deploy.sh contains remove-orphans/--build/prune: it is rehearsal-only and must NEVER run here"
    grep -q "rehearsal-only" deploy.sh && ok "deploy.sh carries the rehearsal-only guard" || bad "deploy.sh has no rehearsal-only guard"
  fi
  grep -qx 'VPS_MODE=rehearsal' deploy.env && bad "deploy.env says VPS_MODE=rehearsal on the production host" || ok "deploy.env is not in rehearsal mode" ;;

deploy-preflight)
  for k in VPS_MODE PG_MAJOR APP_TAG; do info "deploy.env $k=$(sed -n "s/^$k=//p" deploy.env | head -1)"; done
  [ "$(sed -n 's/^PG_MAJOR=//p' deploy.env | head -1)" = 18 ] && ok "PG_MAJOR=18 (matches the running data directory)" || bad "PG_MAJOR is not 18: a recreate would point PostgreSQL 16 at an 18 data directory"
  pg=$("${base[@]}" ps -q postgres); info "postgres image: $(docker inspect -f '{{.Config.Image}} {{.Image}}' "$pg")"
  info "postgres server_version: $(docker exec "$pg" psql -XqAt -U postgres -d school_kit -c 'SHOW server_version')"
  for s in api render-worker; do c=$("${base[@]}" ps -q $s); info "$s image: $(docker inspect -f '{{.Config.Image}}' "$c")"; done
  info "free disk (GiB) on /var/lib/docker: $(df -Pk /var/lib/docker | awk 'NR==2{printf "%.1f",$4/1048576}')"
  docker exec "$pg" psql -XqAt -U postgres -d school_kit -c "BEGIN READ ONLY;
   SELECT 'INFO migrations applied='||count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)||' rolled_back='||count(*) FILTER (WHERE rolled_back_at IS NOT NULL)||' unresolved='||count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) FROM _prisma_migrations;
   SELECT 'INFO allocated_kobo column: '||EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='allocated_kobo');
   COMMIT;"
  "$0" scheduler || bad=1 ;;

rotate-ping)
  new=$(pinned_id); [ -n "$new" ] || { echo "BLOCK ops-pinned not running"; exit 1; }
  h=$(date -u +%H%M); { [ "$h" -ge 0100 ] && [ "$h" -le 0230 ]; } && { echo "BLOCK inside the 01:00-02:30 UTC backup window"; exit 1; }
  docker top "$new" -eo args | grep -qE 'pg_dump|wal-g|backup\.sh' && { echo "BLOCK a backup process is running"; exit 1; }
  pg=$("${base[@]}" ps -q postgres); before=$(docker inspect -f '{{.Id}} {{.State.StartedAt}}' "$pg")
  read -rsp "New heartbeat URL (input hidden): " url; echo
  [[ $url =~ ^https://hc-ping\.com/[0-9a-f-]{36}$ ]] || { echo "BLOCK URL is not https://hc-ping.com/<uuid> (value withheld)"; exit 1; }
  stamp=$(date -u +%Y%m%dT%H%M%SZ); mkdir -p -m 700 config-backups
  cp -p backup.env "config-backups/backup.env.$stamp"
  prev=$(sha256sum backup.env | cut -d' ' -f1)
  tmp=$(mktemp ./backup.env.new.XXXXXX)
  awk -v u="$url" 'BEGIN{d=0} /^HEALTHCHECK_PING_URL=/{print "HEALTHCHECK_PING_URL=" u; d=1; next} {print} END{if(!d) print "HEALTHCHECK_PING_URL=" u}' backup.env > "$tmp"
  chmod 600 "$tmp"; chown --reference=backup.env "$tmp"
  # Only that one line may differ.
  [ "$(diff <(grep -v '^HEALTHCHECK_PING_URL=' backup.env) <(grep -v '^HEALTHCHECK_PING_URL=' "$tmp") | wc -l)" = 0 ] || { rm -f "$tmp"; echo "BLOCK unrelated lines differ"; exit 1; }
  mv -f "$tmp" backup.env
  unset url
  # Recreate ONLY the scheduler: env_file is read at container creation.
  "${compose[@]}" up -d --force-recreate --no-deps --no-build --pull never ops-pinned
  new=$(pinned_id)
  [ "$(docker inspect -f '{{.Id}} {{.State.StartedAt}}' "$pg")" = "$before" ] && ok "PostgreSQL untouched" || bad "PostgreSQL identity changed"
  docker exec "$new" sh -c '. /ops/env.sh; test -n "$HEALTHCHECK_PING_URL" && test -n "$BACKUP_BUCKET" && test -n "$WALG_S3_PREFIX"' && ok "new scheduler holds the settings" || bad "new scheduler missing settings"
  n=$(docker top "$new" -eo args | awk '$1 ~ /(^|\/)cron$/' | wc -l); [ "$n" = 1 ] && ok "one cron" || bad "cron count $n"
  info "previous backup.env sha256 prefix ${prev:0:12}; protected copy config-backups/backup.env.$stamp"
  info "NOT pinged. Confirm on the new check after the next 01:30 UTC run." ;;
*) echo "unknown mode"; exit 2 ;;
esac
exit "$bad"
