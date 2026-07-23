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
-- Required extensions (run as neondb_owner in Neon SQL Editor):
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector, AI/RAG (Phase 5)
```

Verify with `SELECT extname, extversion FROM pg_extension WHERE extname = 'pgcrypto';`
— should return one row. **This is a hard dependency, not a pre-check**: `school_kit`
(the migration role) has DDL privileges scoped to its owned tables/schema, not
database-level `CREATE EXTENSION` — Neon reserves that for `neondb_owner`. The
`20260708000000_phase_3_slice_12_bvn_columns` migration does NOT install
pgcrypto itself; if this manual step is skipped, that migration's `encrypt_bvn`/
`decrypt_bvn` functions (next migration) will fail at creation time with
"function pgp_sym_encrypt(text, text) does not exist."

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
  CORS_ORIGIN="https://<web-url>" \
  WEB_BASE_URL="https://<web-url>" \
  ANTHROPIC_API_KEY="sk-ant-..." \
  PAYSTACK_SECRET_KEY="sk_test_..." \
  PAYSTACK_PUBLIC_KEY="pk_test_..." \
  RESEND_API_KEY="re_..." \
  TERMII_API_KEY="..." \
  TERMII_SENDER_ID="SchoolKit" \
  R2_ACCOUNT_ID="..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  R2_BUCKET="school-kit-prod" \
  STORAGE_DRIVER="r2" \
  SENTRY_DSN_API="..." \
  SENTRY_ENVIRONMENT="staging" \
  RENDER_WORKER_URL="http://school-kit-render-worker.internal:4001" \
  --app school-kit-api
```

**`<web-url>` gotcha (found 2026-07-19, see `docs/deferred.md`'s `CORS_ORIGIN`/`WEB_BASE_URL`
entry for the full incident):** use the app's real serving domain — a
custom domain if one is attached (e.g. `https://app.schoolkit.ng`), not
whatever raw platform URL (`https://school-kit-web.vercel.app`) it happened
to be assigned before a custom domain existed. Two failure modes stack
here: (1) `CORS_ORIGIN` is matched by exact string against the browser's
`Origin` header — no trailing slash, no path, and the wrong domain fails
silently (no error in this app's own logs; the browser just blocks the
response, which surfaces to the frontend as a generic, hard-to-diagnose
error). (2) if a custom domain gets attached to the Vercel project
*after* this command was first run, nothing re-prompts you to update these
two secrets — re-run this section's `CORS_ORIGIN`/`WEB_BASE_URL` lines
whenever a custom domain is attached or changed. `CORS_ORIGIN_PORTAL`/
`PORTAL_BASE_URL` (set separately, not templated in this runbook — see
`CLAUDE.md`'s env var notes) carry the identical exact-match risk; they
happened to be set correctly because `portal.schoolkit.ng` was attached
*before* those secrets were first configured, not because of any
process difference from `CORS_ORIGIN`/`WEB_BASE_URL`'s mistake here.

**`RESEND_API_KEY` was missing from this template entirely until
2026-07-21** (see `docs/deferred.md`'s "Wire Resend for real invitation
email delivery" entry for the full incident) — not a wrong value like the
`<web-url>` gotcha above, a genuine omission: this line simply didn't
exist, so anyone who ran this runbook exactly as written never set the key
at all. `EmailService` degrades silently by design when it's absent
(`GuardiansService.deliverInvitation`'s try/catch logs a `WARN` and moves
on, never blocking the invitation itself) — so the guardian-invite flow
looked completely successful (invite created, accept link worked, login
worked) while zero email was ever actually sent, for as long as this key
was missing. Silent-by-design failure modes like this are exactly why a
missing line in this template is dangerous: there is no error anywhere
that points back to "the secret isn't set" unless someone reads the
Fly logs for the specific `WARN` line or manually checks a real inbox.
When adding a new third-party integration to this codebase, add its
secret to this template in the same PR — don't rely on a later runbook
edit to catch the gap, since nothing forces this file to be re-read once
a Fly app is already provisioned.

**`STORAGE_DRIVER` was missing from this template entirely until
2026-07-21, on both `school-kit-api` and `school-kit-render-worker`**
(found the same investigation session as the `RESEND_API_KEY` gap above —
see `docs/deferred.md`'s R2/storage entry for the full incident). The
`R2_*` credential lines were already templated, but with no
`STORAGE_DRIVER=r2` line to activate them, `storage.module.ts`'s own
fallback (`config.get<string>("STORAGE_DRIVER") ?? "filesystem"`) meant
production ran on the **filesystem driver** the entire time — writing
report-card PDFs and payment/expense receipts to the Fly machine's own
ephemeral container disk, which has no mounted volume, so every file
written is lost on the next deploy or restart. Worse, the filesystem
driver's *serving* mechanism (`DevStorageController`, which proxies bytes
for locally-served download links) is deliberately dev-only —
`isProd ? [] : [DevStorageController]` in this same module — so even a
file that happened to survive until the next request had no route to be
fetched through in production; confirmed directly with `GET /api/v1/
dev-storage/...` against the live API returning `404`. Investigated for
real damage before fixing: **zero real files were ever lost** — every
`Payment.receiptUrl` and `ReportCard.artifactUrl` in production is
`null`, because (per the `NEXT_PUBLIC_API_URL` incident above) every
school in the database is a smoke-test artifact; nothing has ever
exercised the real write path. Purely a forward-looking fix, not a
recovery. Once real R2 credentials are set, `STORAGE_DRIVER=r2` switches
both the write target (a real Cloudflare R2 bucket) and the serve
mechanism (native presigned URLs from `R2StorageDriver.signUrl()` — the
browser fetches directly from R2, no app-side proxy controller needed in
production, unlike dev) in one flip, with zero application code changes.
Verify with a real end-to-end write+fetch after switching, not just that
the secrets are present — presence was never the failure mode for `R2_*`
here, activation was.

**The bucket name in this template was also wrong — fixed 2026-07-23.**
This template (and the original Slice 1b provisioning journal it was
copied from) suggested `school-kit-staging`, but that bucket does not
exist under the real account: confirmed by calling R2's S3-compatible API
directly with the real credentials — `ListBuckets` itself came back `403`
(the token is scoped to a single bucket, not account-wide; a permissions
rejection, not a signature failure, so this didn't mean the credentials
were bad), then `HeadBucket`/`ListObjectsV2` against candidate names
confirmed the real bucket is **`school-kit-prod`** (`school-kit-staging`,
`school-kit-api`, and bare `school-kit` all `403`). Caught before use this
time — worth flagging as the fifth instance of the same "documented value
never verified against what was actually provisioned" pattern this
project has hit in a week, this one just found proactively instead of via
a bug report. `.env.example`'s own `R2_BUCKET=school-kit-dev` is a
genuinely different, correct value (the local-dev bucket, not this one) —
left untouched.

### school-kit-render-worker

```bash
flyctl secrets set \
  DATABASE_URL="postgresql://app_user:<pw>@ep-xxx-pooler...neon.tech/neondb?sslmode=require" \
  REDIS_URL="<Fly Redis private URL>" \
  BETTER_AUTH_SECRET="<same value as API>" \
  R2_ACCOUNT_ID="..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  R2_BUCKET="school-kit-prod" \
  STORAGE_DRIVER="r2" \
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
