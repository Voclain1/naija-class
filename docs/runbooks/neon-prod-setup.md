# Production setup — Neon + Fly provisioning

Run these steps once before the first `deploy-staging.yml` execution.
All commands run from the repo root unless stated otherwise.

---

## 1. Neon — create project and role split

### 1a. Create project

Create a new project at https://neon.tech. Choose a region close to Fly's `jnb`
(Johannesburg); `eu-central-1` (Frankfurt) is the closest currently available.
Note the **connection string** Neon shows after creation — that is your
`neondb_owner` superuser URL. Keep it; you need it only for this setup step.

### Required extensions

Run once, as `neondb_owner` (or any role with `CREATE` on the database), before
the first migration:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- Prisma id generation
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector, AI/RAG (Phase 5)
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- BVN column encryption (Phase 3 / Slice 12)
```

Verify with `SELECT extname, extversion FROM pg_extension WHERE extname = 'pgcrypto';`
— should return one row. The Phase-3/Slice-12 migration also runs
`CREATE EXTENSION IF NOT EXISTS pgcrypto;` itself (idempotent), so this step is
a belt-and-braces pre-check, not a hard dependency.

### 1b. Create the two application roles

Open the Neon SQL editor (or connect via `psql` as `neondb_owner`) and run the
following in order.

```sql
-- ─── Step 1: migration role (school_kit) ────────────────────────────────────
--
-- school_kit runs `prisma migrate deploy` — it needs CREATE TABLE, ALTER TABLE,
-- CREATE INDEX, CREATE EXTENSION. It must NOT have SUPERUSER (CLAUDE.md hard
-- rule: "Runtime DB role must NOT have SUPERUSER or BYPASSRLS" — that rule
-- applies to app_user, the runtime role, not to school_kit).
--
-- school_kit MUST have BYPASSRLS — see the ALTER ROLE below.
--
-- school_kit is NOT a runtime role. It connects only during migrations (CI step)
-- and is the OWNER of all SECURITY DEFINER functions.

CREATE ROLE school_kit WITH LOGIN PASSWORD '<openssl rand -hex 32>';

-- BYPASSRLS is required for school_kit (not app_user).
-- SECURITY DEFINER functions owned by school_kit query the users table
-- pre-tenant (before app.current_school_id is set). Without BYPASSRLS,
-- FORCE RLS filters every row and all pre-tenant auth lookups return zero
-- rows — login, session resolution, invitation lookup all fail silently
-- with INVALID_CREDENTIALS or NOT_FOUND. This was discovered during the
-- first staging smoke test (2026-06-26).
ALTER ROLE school_kit BYPASSRLS;

-- Allow creating and using objects in the public schema.
GRANT CREATE ON SCHEMA public TO school_kit;
GRANT USAGE  ON SCHEMA public TO school_kit;

-- ─── Step 2: runtime role (app_user) ────────────────────────────────────────
--
-- app_user is what the running API connects as (DATABASE_URL on the Fly app).
-- DML only — no DDL. This role is subject to FORCE ROW LEVEL SECURITY.
-- Cannot BYPASSRLS; cannot create, alter, or drop tables.

CREATE ROLE app_user WITH LOGIN PASSWORD '<openssl rand -hex 32>';

GRANT CONNECT ON DATABASE neondb TO app_user;
GRANT USAGE   ON SCHEMA public   TO app_user;

-- WARNING: Must run as school_kit (table owner), not neondb_owner.
-- neondb_owner does not own the tables — school_kit does (migrations run as school_kit).
-- GRANT ON ALL TABLES run as neondb_owner silently grants nothing.

-- Step 1: Allow neondb_owner to impersonate school_kit
GRANT school_kit TO neondb_owner;
SET ROLE school_kit;

-- Step 2: Grant app_user DML on all existing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- Step 3: Set default privileges so future migration tables auto-grant to app_user
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

RESET ROLE;
```

### 1c. Get connection strings

From the Neon dashboard, create connection strings for both roles.
Neon shows a pooled URL (port 5432 through PgBouncer) and a direct URL (port 5432
to the compute directly). Use the **direct** URL for `school_kit` — Prisma requires
a non-pooled connection for `migrate deploy` (transaction mode poolers don't support
`SET` commands that migrations rely on).

```
# Migration role — direct connection (non-pooled)
DIRECT_URL=postgresql://school_kit:<password>@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require

# Runtime role — pooled connection (PgBouncer)
DATABASE_URL=postgresql://app_user:<password>@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

### 1d. Verify the role split

After the first `prisma migrate deploy` run (step 3 below), connect as `app_user`
and confirm RLS is enforced:

```sql
-- Connect as app_user (Neon SQL editor → switch role, or a separate psql session)
-- This should return 0 rows even if school rows exist — RLS blocks access
-- without SET LOCAL app.current_school_id.
SELECT * FROM schools LIMIT 5;

-- This should fail with "permission denied for schema public" or similar.
CREATE TABLE rls_bypass_test (id SERIAL);
```

If `SELECT * FROM schools` returns rows without setting `app.current_school_id`,
RLS is not active — stop and diagnose before proceeding.

---

## 2. Fly Redis

```bash
flyctl redis create \
  --name school-kit-redis \
  --region jnb \
  --no-replicas
```

Note the private network URL Fly prints (`redis://default:<token>@fly-school-kit-redis.upstash.io:6379`
or the `.internal` form). Use this as `REDIS_URL` in secrets for both apps.

---

## 3. Fly apps

`school-kit-api` was created in slice 1a. Only the render worker is new here.

```bash
flyctl apps create school-kit-render-worker --region jnb
```

---

## 4. Run first migration

Before setting secrets, run the initial migration to create the schema.
The Fly app doesn't need to be running for this; it hits Neon directly.

```bash
# From repo root, with DIRECT_URL set to the school_kit connection string:
export DIRECT_URL="postgresql://school_kit:<password>@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require"
export DATABASE_URL="postgresql://app_user:<password>@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require"
pnpm --filter @school-kit/db generate
pnpm -r --filter "./packages/*" build
pnpm --filter @school-kit/api build
pnpm --filter @school-kit/db migrate:deploy
```

Then re-run the DML grant (step 1b) to cover tables created by the migration.
**Must run as school_kit, not neondb_owner** — see the warning in step 1b.

```sql
SET ROLE school_kit;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
RESET ROLE;
```

Subsequent deploys do not need this re-grant — the `ALTER DEFAULT PRIVILEGES`
in step 1b handles it for any tables created from now on by school_kit.

---

## 5. Fly secrets

### school-kit-api

```bash
flyctl secrets set \
  DATABASE_URL="postgresql://app_user:<pw>@ep-xxx-pooler...neon.tech/neondb?sslmode=require" \
  REDIS_URL="<Fly Redis private URL>" \
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  BETTER_AUTH_URL="https://school-kit-api.fly.dev" \
  API_PORT="4000" \
  CORS_ORIGIN="https://<vercel-web-url>" \
  WEB_BASE_URL="https://<vercel-web-url>" \
  ANTHROPIC_API_KEY="sk-ant-..." \
  PAYSTACK_SECRET_KEY="sk_test_..." \
  PAYSTACK_PUBLIC_KEY="pk_test_..." \
  TERMII_API_KEY="..." \
  TERMII_SENDER_ID="SchoolKit" \
  R2_ACCOUNT_ID="..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  R2_BUCKET="school-kit-staging" \
  SENTRY_DSN_API="..." \
  SENTRY_ENVIRONMENT="staging" \
  RENDER_WORKER_URL="http://school-kit-render-worker.internal:4001" \
  --app school-kit-api
```

### school-kit-render-worker

```bash
flyctl secrets set \
  DATABASE_URL="postgresql://app_user:<pw>@ep-xxx-pooler...neon.tech/neondb?sslmode=require" \
  REDIS_URL="<Fly Redis private URL>" \
  BETTER_AUTH_SECRET="<same value as API>" \
  R2_ACCOUNT_ID="..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  R2_BUCKET="school-kit-staging" \
  SENTRY_DSN_API="..." \
  SENTRY_ENVIRONMENT="staging" \
  --app school-kit-render-worker
```

`RENDER_WORKER_URL` is **not** set on the render worker itself — that var is only
needed by the API to wake the render worker via HTTP.

---

## 6. GitHub Actions secrets

Set in repository Settings → Secrets → Actions:

| Secret | Value |
|---|---|
| `FLY_API_TOKEN` | `flyctl auth token` |
| `STAGING_DATABASE_URL` | app_user pooled Neon URL |
| `STAGING_DIRECT_URL` | **school_kit direct Neon URL** (not neondb_owner) |
| `SENTRY_AUTH_TOKEN` | optional; `project:releases` + `org:read` scope |
| `SENTRY_ORG` | optional; your Sentry organisation slug |

`STAGING_DIRECT_URL` must be the **school_kit** role connection string, not
`neondb_owner`. `neondb_owner` is Neon's superuser and has `BYPASSRLS`, which
silently skips every RLS policy — connecting the migration runner as `neondb_owner`
would mean that any `prisma migrate deploy` run could execute queries that bypass
tenant isolation. Use `school_kit` (non-superuser, DDL-only) instead.
