# School Kit API — multi-stage Dockerfile
#
# Build from the repo root (the build context is the whole monorepo):
#   docker build -f apps/api/Dockerfile -t school-kit-api .
#
# Stage 1 (builder):  install all workspace deps (incl. Chromium download) +
#                     generate Prisma client + compile TypeScript.
# Stage 2 (runtime):  copy the compiled workspace + install OS-level Chromium
#                     system libraries; run as non-root.

# ── Stage 1: builder ─────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

RUN corepack enable

# unzip is required by puppeteer's postinstall: Chrome for Linux ships as a
# .zip archive and @puppeteer/browsers extracts it with the native unzip binary.
# node:22-slim (Debian Bookworm slim) does not include unzip by default.
RUN apt-get update && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests before source so this layer is cache-stable across
# source-only changes — pnpm install only re-runs when lock files change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/
COPY packages/types/package.json  ./packages/types/
COPY packages/db/package.json     ./packages/db/
COPY apps/api/package.json        ./apps/api/
# Non-API apps: copy manifests so pnpm can resolve the workspace graph.
# apps/web, apps/mobile, and e2e are declared importers in pnpm-lock.yaml;
# --frozen-lockfile fails if their package.json files are absent.
# Source directories are excluded by .dockerignore; only config files + manifests arrive.
COPY apps/web/package.json    ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
COPY e2e/package.json         ./e2e/

# Chromium must land at a predictable path so Stage 2 can copy it precisely.
# Without PUPPETEER_CACHE_DIR the binary goes to ~/.cache/puppeteer (root's
# home), which varies by uid and is awkward to copy across stages.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# Docker Desktop's virtual network can be slower than the host; undici's
# default 300s body-timeout causes the Chromium binary download (~170MB) to
# fail on slower connections.  Raise both pnpm's per-fetch body timeout and
# puppeteer's Chromium download timeout to 20 minutes.
ENV PUPPETEER_DOWNLOAD_TIMEOUT=1200000
RUN echo "fetch-timeout=1200000" >> /root/.npmrc

RUN pnpm install --frozen-lockfile

# Copy source after install so the dep/Chromium layer stays cached.
COPY packages/config/ ./packages/config/
COPY packages/types/  ./packages/types/
COPY packages/db/     ./packages/db/
COPY apps/api/        ./apps/api/

# Generate the Prisma client (schema → TS types; no DB connection used).
# The packages/db `generate` script wraps prisma with dotenv-cli to load
# ../../.env — that file doesn't exist in Docker. Call prisma directly.
# DATABASE_URL / DIRECT_URL must be non-empty for schema validation but are
# never used to connect during generate.
RUN DATABASE_URL="postgresql://x:x@localhost/x" \
    DIRECT_URL="postgresql://x:x@localhost/x" \
    pnpm --filter @school-kit/db exec prisma generate --schema=./prisma/schema.prisma

# Build in workspace dependency order.
RUN pnpm --filter @school-kit/types build
RUN pnpm --filter @school-kit/db    build
RUN pnpm --filter @school-kit/api   build


# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

# OS libraries required by headless Chromium on Debian 12 (Bookworm).
# node:22-slim is Debian Bookworm stable; the t64 suffix packages
# (libcups2t64, libasound2t64) are Debian 13 (Trixie) only — Bookworm
# still ships libcups2 and libasound2 under their original names.
# fonts-liberation provides Western glyphs for Naija names and the WAEC grid.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3            \
    libatk1.0-0        \
    libatk-bridge2.0-0 \
    libcups2           \
    libdrm2            \
    libxkbcommon0      \
    libxcomposite1     \
    libxdamage1        \
    libxfixes3         \
    libxrandr2         \
    libgbm1            \
    libasound2         \
    libpango-1.0-0     \
    libcairo2          \
    fonts-liberation   \
    && rm -rf /var/lib/apt/lists/*

# Copy the entire built workspace: node_modules (pnpm layout with .pnpm store
# + workspace symlinks), compiled dist/, generated Prisma client, and the
# Chromium binary at .cache/puppeteer/.
#
# Source .ts files come along because a full COPY is simpler than surgically
# listing every subdirectory. A future pass can prune them to shrink image
# size once the deploy proves out (see docs/deferred.md).
COPY --from=builder /app ./

# Resolve the pre-downloaded Chromium binary from the same cache dir used
# during build, and suppress the postinstall download that would otherwise
# fire if any code path re-invokes the puppeteer install script.
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

# Drop to the built-in non-root node user (uid 1000).
# BrowserPool.LAUNCH_ARGS already passes --no-sandbox; that flag is meaningful
# only when the process runs as non-root (root silently skips the sandbox
# without the flag, giving a false sense of security).
USER node

CMD ["node", "apps/api/dist/main.js"]
