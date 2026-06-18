# School Kit API — multi-stage Dockerfile (Tier 2: PDF rendering offloaded)
#
# Build from the repo root:
#   docker build -f apps/api/Dockerfile -t school-kit-api .
#
# Stage 1 (builder):  install workspace deps (Chromium download SKIPPED),
#                     generate Prisma client, compile TypeScript, prune to
#                     prod dep closure with `pnpm deploy`.
# Stage 2 (runtime):  copy the pruned app dir; no Chromium libs; ~600MB target.
#
# PDF rendering runs in school-kit-render-worker (Dockerfile.render, 2 GB Fly
# app). This image only enqueues BullMQ render jobs.

# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

RUN corepack enable

# Copy workspace manifests before source so this layer is cache-stable across
# source-only changes — pnpm install only re-runs when lock files change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json  ./packages/types/
COPY packages/db/package.json     ./packages/db/
COPY apps/api/package.json        ./apps/api/
# Non-API apps: manifests only — pnpm validates the full lockfile importer list.
COPY apps/web/package.json    ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
COPY e2e/package.json         ./e2e/

# Skip Chromium download — the API never renders PDFs. Dockerfile.render omits
# this env var so Chrome downloads in the render worker build.
# PUPPETEER_CACHE_DIR and PUPPETEER_DOWNLOAD_TIMEOUT are kept for parity but
# are no-ops when skip is set. No `unzip` needed either (no .zip to extract).
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
ENV PUPPETEER_DOWNLOAD_TIMEOUT=1200000
RUN echo "fetch-timeout=1200000" >> /root/.npmrc

RUN pnpm install --frozen-lockfile

# Copy source after install so the dep layer stays cached on source-only changes.
COPY packages/config/ ./packages/config/
COPY packages/types/  ./packages/types/
COPY packages/db/     ./packages/db/
COPY apps/api/        ./apps/api/

# Generate the Prisma client against a dummy URL (no DB connection made).
RUN DATABASE_URL="postgresql://x:x@localhost/x" \
    DIRECT_URL="postgresql://x:x@localhost/x" \
    pnpm --filter @school-kit/db exec prisma generate --schema=./prisma/schema.prisma

# Build in workspace dependency order.
RUN pnpm --filter @school-kit/types build
RUN pnpm --filter @school-kit/db    build
RUN pnpm --filter @school-kit/api   build

# Prune to the API's production dependency closure.
#
# pnpm deploy copies:
#   - apps/api/ files (dist/, src/, package.json, …) to /app/api-deploy/ root
#   - workspace packages (@school-kit/db, @school-kit/types) with their dist/
#     and generated/ into node_modules/@school-kit/<name>/
#   - all third-party prod deps into node_modules/
# devDependencies (vitest, ts-node, @nestjs/cli, ~2 GB of dev tooling) excluded.
# Chromium is absent: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true above ensured no
# download; puppeteer package itself (~5 MB) is in prod deps but never loaded
# (ReportCardRenderModule is removed from AppModule in Tier 2).
RUN pnpm --filter @school-kit/api deploy --prod /app/api-deploy


# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

# No Chromium system libraries — the API never renders PDFs.

COPY --from=builder /app/api-deploy ./

ENV NODE_ENV=production

# Drop to the built-in non-root node user (uid 1000).
USER node

# pnpm deploy places the package files at the deploy dir root, so the compiled
# entry point is dist/main.js (not apps/api/dist/main.js as in the full
# workspace copy).
CMD ["node", "dist/main.js"]
