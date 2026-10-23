# Shared by the scripts here (deploy.sh, deploy-landing.sh, db-replace.sh,
# start-apps.sh), so they all agree on which compose files, settings and
# optional services are in play. Source it; it cd's to this folder.
#
#   deploy.env          School Kit's settings (written by deploy-vps.yml)
#   landing.deploy.env  the marketing site's (written by deploy-landing.sh);
#                       present = the `landing` service is on
#   VPS_MODE=rehearsal  adds docker-compose.rehearsal.yml
#   CBT_ENABLED=true    the `cbt` service is on
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p sites

compose_files=(-f docker-compose.yml)
if grep -q '^VPS_MODE=rehearsal$' deploy.env; then compose_files+=(-f docker-compose.rehearsal.yml); fi
compose_envs=(--env-file deploy.env)
profiles=()
if grep -q '^CBT_ENABLED=true$' deploy.env; then profiles+=(cbt); fi
if [ -f landing.deploy.env ]; then
  compose_envs+=(--env-file landing.deploy.env)
  profiles+=(landing)
fi
COMPOSE_PROFILES=$(IFS=,; echo "${profiles[*]}")
export COMPOSE_PROFILES

compose() { docker compose "${compose_envs[@]}" "${compose_files[@]}" "$@"; }
reload_caddy() { compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile || compose restart caddy; }
