#!/bin/bash
# Switches schoolkit.ng (the marketing site) to a new image, with automatic
# rollback. Run on the server by schoolkit-landing's deploy-vps.yml:
#   ./deploy-landing.sh <tag> <host>      e.g. <sha> schoolkit.ng
# Its settings arrive as landing.env; its tag and host live in
# landing.deploy.env, apart from School Kit's deploy.env, so neither deploy
# overwrites the other's.
set -euo pipefail
NEW_TAG="${1:?usage: deploy-landing.sh <tag> <host>}"
HOST="${2:?usage: deploy-landing.sh <tag> <host>}"
cd "$(dirname "$0")"
PREV_TAG=$(grep '^LANDING_TAG=' landing.deploy.env 2>/dev/null | cut -d= -f2 || true)

write_state() {
  printf 'LANDING_TAG=%s\nLANDING_HOST=%s\n' "$1" "$HOST" > landing.deploy.env
}
write_state "$NEW_TAG"
. ./lib.sh

# www. redirects to the bare domain, which lib/brand.ts names canonical.
# X-Forwarded-For is overwritten, not appended: lib/pioneer-abuse.ts keys its
# rate limit on the first address in it, so a caller must not choose it.
cat > sites/landing.caddy <<'CADDY'
{$LANDING_HOST} {
	encode zstd gzip
	reverse_proxy landing:3000 {
		header_up X-Real-IP {client_ip}
		header_up X-Forwarded-For {client_ip}
	}
}

www.{$LANDING_HOST} {
	redir https://{$LANDING_HOST}{uri} permanent
}
CADDY

compose pull landing
compose up -d landing caddy
reload_caddy

for i in $(seq 1 40); do
  if curl -fsS -m 5 -o /dev/null http://127.0.0.1:3004/; then
    echo "schoolkit.ng healthy on $NEW_TAG (was ${PREV_TAG:-none})"
    exit 0
  fi
  sleep 3
done

echo "::error::landing $NEW_TAG did not become healthy"
compose logs --tail 60 landing || true
if [ -n "$PREV_TAG" ] && [ "$PREV_TAG" != "$NEW_TAG" ]; then
  echo "rolling back to $PREV_TAG"
  write_state "$PREV_TAG"
  . ./lib.sh
  compose up -d landing
fi
exit 1
