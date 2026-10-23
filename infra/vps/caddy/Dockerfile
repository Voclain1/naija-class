# Caddy with the Cloudflare DNS plugin. School addresses (<code>.schoolkit.ng)
# need a wildcard certificate, which Let's Encrypt issues only through a DNS
# challenge (docs/runbooks/school-addresses.md §2). Built on the server by
# docker compose. v0.2.4 is the first release that accepts Cloudflare's newer
# token format (cfut_/cfat_); older ones reject it and Caddy will not start.
FROM caddy:2.10-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare@v0.2.4

FROM caddy:2.10-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
