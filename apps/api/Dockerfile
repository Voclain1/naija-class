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
# Non-API workspace members: manifests only — pnpm validates the full lockfile
# importer list. This block MUST cover every importer in pnpm-lock.yaml.
# packages/ai, packages/ui and apps/portal were missing here until 2026-08-09
# (the build tolerated it because --frozen-lockfile doesn't hard-fail on an
# absent importer directory, so the omission was silent, not loud).
#
# packages/ai IS a real apps/api dependency as of Phase 5 slice 1, so it now
# needs its source and its build below, not just this manifest.
#
# That is exactly what the note here used to instruct, and slice 1 did step (1)
# — adding the workspace dependency — without steps (2) and (3). The deploy
# broke on the first push to main afterwards (run 31575051028, 2026-08-12),
# and nothing before that point could have caught it: `pnpm build` at the repo
# root goes through turbo, which builds every workspace package, while this
# Dockerfile hand-lists them. So lint, typecheck, test AND build were all green
# on a tree whose production image could not compile.
#
# The predicted symptom in the old note was a boot-time ERR_MODULE_NOT_FOUND.
# The real one was louder and earlier — tsc failing the image build with TS2307
# "Cannot find module '@school-kit/ai'" — because apps/api's build needs the
# type declarations, not just the runtime files. Either way: any new workspace
# package apps/api imports must be added in BOTH places below.
COPY packages/ai/package.json ./packages/ai/
COPY packages/ui/package.json ./packages/ui/
COPY apps/web/package.json    ./apps/web/
COPY apps/portal/package.json ./apps/portal/
COPY apps/mobile/package.json ./apps/mobile/
COPY e2e/package.json         ./e2e/

# Skip Chromium download — the API never renders PDFs. Dockerfile.render omits
# this env var so Chrome downloads in the render worker build.
# PUPPETEER_CACHE_DIR and PUPPETEER_DOWNLOAD_TIMEOUT are kept for parity but
# are no-ops when skip is set. No `unzip` needed either (no .zip to extract).
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
ENV PUPPETEER_DOWNLOAD_TIMEOUT=1200000
RUN echo "fetch-timeout=1200000" >> /root/.npmrc

RUN pnpm install --frozen-lockfile

# Copy source after install so the dep layer stays cached on source-only changes.
COPY packages/config/ ./packages/config/
COPY packages/types/  ./packages/types/
COPY packages/ai/     ./packages/ai/
COPY packages/db/     ./packages/db/
COPY apps/api/        ./apps/api/

# Generate the Prisma client against a dummy URL (no DB connection made).
RUN DATABASE_URL="postgresql://x:x@localhost/x" \
    DIRECT_URL="postgresql://x:x@localhost/x" \
    pnpm --filter @school-kit/db exec prisma generate --schema=./prisma/schema.prisma

# Build in workspace dependency order. @school-kit/ai has no workspace
# dependencies of its own (only @anthropic-ai/sdk), so it only has to precede
# the api build.
RUN pnpm --filter @school-kit/types build
RUN pnpm --filter @school-kit/ai    build
RUN pnpm --filter @school-kit/db    build
RUN pnpm --filter @school-kit/api   build

# Strip Prisma query engine binaries for non-Bookworm targets before pnpm
# deploy copies the generated client into the pruned closure. The runtime
# image is Debian Bookworm (OpenSSL 3); only debian-openssl-3.0.x is needed.
# Leaving other binaries (debian-openssl-1.1.x, rhel-*, etc.) causes the
# wrong .so to be selected and produces libssl.so.1.1: cannot open shared
# object file at startup.
RUN find /app/packages/db/generated/client -name "*.node" \
    | grep -v "debian-openssl-3.0.x" \
    | xargs rm -f

# Prune to the API's production dependency closure.
#
# pnpm deploy copies:
#   - apps/api/ files (dist/, src/, package.json, …) to /app/api-deploy/ root
#   - workspace packages (@school-kit/db, @school-kit/types) with their dist/
#     and generated/ into node_modules/@school-kit/<name>/
#   - all third-party prod deps into node_modules/
# devDependencies (vitest, ts-node, @nestjs/cli, ~2 GB of dev tooling) excluded.
# Chromium is absent: PUPPETEER_SKIP_DOWNLOAD=true above ensured no
# download; puppeteer package itself (~5 MB) is in prod deps but never loaded
# (ReportCardRenderModule is removed from AppModule in Tier 2).
RUN pnpm --filter @school-kit/api deploy --prod /app/api-deploy


# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

# libssl3 is required by the Prisma query engine binary (debian-openssl-3.0.x).
# node:22-slim (Debian Bookworm slim) omits it; install explicitly.
# No Chromium system libraries — the API never renders PDFs.
RUN apt-get update -y && apt-get install -y --no-install-recommends libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/api-deploy ./

ENV NODE_ENV=production

# Sentry release tag — set by `flyctl deploy --build-arg SENTRY_RELEASE=<sha>`.
# Defaults to "unknown" when not supplied so the app still starts cleanly.
ARG SENTRY_RELEASE=unknown
ENV SENTRY_RELEASE=${SENTRY_RELEASE}

# Drop to the built-in non-root node user (uid 1000).
USER node

# pnpm deploy places the package files at the deploy dir root, so the compiled
# entry point is dist/main.js (not apps/api/dist/main.js as in the full
# workspace copy).
CMD ["node", "dist/main.js"]
