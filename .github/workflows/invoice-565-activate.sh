#!/usr/bin/env bash
set -euo pipefail
umask 077
cd /opt/school-kit
exec 9>.invoice-565-release.lock
flock -n 9
api=$1 web=$2 expected_public=$3
[[ $api =~ ^ghcr\.io/voclain1/school-kit-api@sha256:[0-9a-f]{64}$ ]]
[[ $web =~ ^ghcr\.io/voclain1/school-kit-web@sha256:[0-9a-f]{64}$ ]]
actual_public=$(grep -E '^(NEXT_PUBLIC_[A-Z0-9_]+|SESSION_COOKIE_DOMAIN)=' web.env | sha256sum | cut -d' ' -f1)
test "$actual_public" = "$expected_public"
base=(docker compose --env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml)
override=invoice-565.override.yml
test ! -e "$override"
test -n "$("${base[@]}" ps -q ops-pinned)"
protected() {
  local ids
  ids=$(docker ps -q)
  test -n "$ids"
  docker inspect --format '{{.Id}} {{.State.StartedAt}} {{index .Config.Labels "com.docker.compose.project"}} {{index .Config.Labels "com.docker.compose.service"}}' $ids |
    awk '!( ($3=="school-kit") && ($4=="api" || $4=="web"))' | sort
}
fingerprints() { sha256sum deploy.env api.env web.env backup.env backup-ops.override.yml; }
before=$(protected)
configs=$(fingerprints)
old_api=$(docker inspect -f '{{.Config.Image}}' "$("${base[@]}" ps -q api)")
old_web=$(docker inspect -f '{{.Config.Image}}' "$("${base[@]}" ps -q web)")
docker image inspect "$old_api" "$old_web" "$api" "$web" >/dev/null
write_override() {
  printf 'services:\n  api:\n    image: "%s"\n  web:\n    image: "%s"\n' "$1" "$2" > "$override"
}
dc=("${base[@]}" -f "$override")
health() {
  for _ in {1..40}; do
    if curl -fsS --max-time 4 -o /dev/null http://127.0.0.1:4000/api/v1/health &&
       curl -fsS --max-time 4 -o /dev/null http://127.0.0.1:3001/staff/login; then return; fi
    sleep 3
  done
  return 1
}
write_override "$api" "$web"
if ! "${dc[@]}" up -d --no-deps --no-build --pull never api web || ! health; then
  write_override "$old_api" "$old_web"
  "${dc[@]}" up -d --no-deps --no-build --pull never api web
  health
  echo 'Health check failed; restored previous API and web images only.' >&2
  exit 1
fi
test "$(docker inspect -f '{{.Config.Image}}' "$("${dc[@]}" ps -q api)")" = "$api"
test "$(docker inspect -f '{{.Config.Image}}' "$("${dc[@]}" ps -q web)")" = "$web"
test "$before" = "$(protected)"
test "$configs" = "$(fingerprints)"
ops=$("${dc[@]}" ps -q ops-pinned)
listing=$(docker top "$ops" -eo pid,args)
awk 'NR>1 && $2 ~ /(^|\/)cron$/ {n++} END {exit n!=1}' <<<"$listing"
docker exec "$ops" test -s /etc/cron.d/school-kit
echo 'Scoped API and web digests healthy; other running containers, config files and the pinned backup scheduler are unchanged.'
