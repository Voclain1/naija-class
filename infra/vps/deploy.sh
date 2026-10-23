#!/bin/bash
# Switches School Kit to a new image tag, with automatic rollback.
# Run on the server by deploy-vps.yml:   ./deploy.sh <tag>
# Manual rollback:                       ./deploy.sh <previous tag>
# (`docker image ls | grep school-kit` lists the tags still on the server.)
#
# Migrations are NOT run here: the workflow runs `prisma migrate deploy`
# first, as the Fly deploy does. A rollback swaps images only, never the
# schema, so migrations must stay backward compatible, as today.
set -euo pipefail
NEW_TAG="${1:?usage: deploy.sh <image tag>}"
. "$(dirname "$0")/lib.sh"

apps=(api render-worker web portal)
if [[ ",$COMPOSE_PROFILES," == *",cbt,"* ]]; then
  apps+=(cbt)
  printf '{$CBT_HOST} {\n\timport upstream cbt:3000\n}\n' > sites/cbt.caddy
else
  rm -f sites/cbt.caddy
fi

# Every school's address goes to the portal, except /staff, which goes to the
# staff app with the address named in X-Schoolkit-Host, overwriting whatever a
# browser sent (docs/runbooks/school-addresses.md §5). The exact hosts above
# (api., app., portal., cbt., www.) are more specific, so they win.
# Without a token Caddy would refuse its whole configuration, taking every
# site down, so the wildcard site waits for one.
if grep -q '^SCHOOL_ADDRESS_DOMAIN=..*' deploy.env && ! grep -q '^CLOUDFLARE_API_TOKEN=..*' deploy.env; then
  echo "::warning::SCHOOL_ADDRESS_DOMAIN is set but CLOUDFLARE_DNS_API_TOKEN is not: school addresses stay off."
  rm -f sites/school-addresses.caddy
elif grep -q '^SCHOOL_ADDRESS_DOMAIN=..*' deploy.env; then
  cat > sites/school-addresses.caddy <<'CADDY'
*.{$SCHOOL_ADDRESS_DOMAIN} {
	tls {
		dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	}
	encode zstd gzip
	handle /staff* {
		reverse_proxy web:3000 {
			header_up X-Real-IP {client_ip}
			header_up X-Schoolkit-Host {host}
		}
	}
	handle {
		reverse_proxy portal:3000 {
			header_up X-Real-IP {client_ip}
			header_up -X-Schoolkit-Host
		}
	}
}
CADDY
else
  rm -f sites/school-addresses.caddy
fi

set_tag() { sed -i '/^APP_TAG=/d' deploy.env; echo "APP_TAG=$1" >> deploy.env; }
healthy() {
  curl -fsS -m 5 -o /dev/null http://127.0.0.1:4000/api/v1/health &&
  curl -fsS -m 5 -o /dev/null http://127.0.0.1:3001/staff/login &&
  curl -fsS -m 5 -o /dev/null http://127.0.0.1:3002/api/health &&
  { [[ " ${apps[*]} " != *" cbt "* ]] || curl -fsS -m 5 -o /dev/null http://127.0.0.1:3003/; } &&
  [ "$(docker inspect -f '{{.State.Running}}' "$(compose ps -q render-worker)")" = true ]
}

PREV_TAG=$(grep '^APP_TAG=' deploy.env | cut -d= -f2 || true)
set_tag "$NEW_TAG"
compose pull "${apps[@]}"
compose up -d --build --remove-orphans
# Caddy reads its config at start; reload picks up the exam site switching.
reload_caddy

for i in $(seq 1 60); do
  if healthy; then
    echo "healthy on $NEW_TAG (was ${PREV_TAG:-none})"
    echo "$PREV_TAG" > .previous-tag
    docker image prune -af --filter "until=336h" >/dev/null || true
    exit 0
  fi
  sleep 3
done

echo "::error::$NEW_TAG did not become healthy"
compose logs --tail 60 "${apps[@]}" || true
if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$NEW_TAG" ]; then
  echo "rolling back to $PREV_TAG"
  set_tag "$PREV_TAG"
  compose up -d "${apps[@]}"
fi
exit 1
