# Migration runner for the controlled cutover (docs/runbooks/batch2-acceptance-and-batch3.md).
# Immutable, built from the exact release commit by .github/workflows/batch2-images.yml, so an
# operator on a VPS (or a tablet) needs no repository checkout, Node or pnpm to migrate.
#   docker run --rm --network <net> -e DIRECT_URL=... <image>@sha256:... migrate status
#   docker run --rm --network <net> -e DIRECT_URL=... <image>@sha256:... migrate deploy
# Build from the repo root:  docker build -f infra/vps/migrate/Dockerfile .
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json  ./packages/types/
COPY packages/db/package.json     ./packages/db/
COPY apps/api/package.json        ./apps/api/
COPY packages/ai/package.json ./packages/ai/
COPY packages/ui/package.json ./packages/ui/
COPY apps/web/package.json    ./apps/web/
COPY apps/portal/package.json ./apps/portal/
COPY apps/mobile/package.json ./apps/mobile/
COPY e2e/package.json         ./e2e/
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN pnpm install --frozen-lockfile --filter @school-kit/db...
COPY packages/db/ ./packages/db/
RUN chown -R node:node /app
USER node
WORKDIR /app/packages/db
# The local binary: no pnpm/corepack download at run time (the container has no cache and may have no egress).
ENTRYPOINT ["./node_modules/.bin/prisma"]
CMD ["migrate", "status"]
