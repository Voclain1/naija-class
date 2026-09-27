# Deploy rollback runbook

This runbook covers the three failure classes after a staging deploy and tells
you what to do for each one.

> **`flyctl` works on the maintainer's Windows machine — verified 2026-09-26.**
> This note previously said the opposite: that Windows Application Control
> blocked every command here (recorded 2026-09-01) and that you had to use the
> web dashboard. That is no longer true — flyctl v0.4.83 was run repeatedly on
> that machine on 2026-09-26, including the `flyctl deploy --image` rollback
> documented below, against production.
>
> The Fly web dashboard (fly.io → app → **Releases**) remains a fine fallback
> and is the right tool if the CLI is ever unavailable mid-incident.

---

## ⚠ There is no `flyctl releases rollback`

**`flyctl releases rollback` does not exist.** `flyctl releases` takes only
flags (`-a/--app`, `-c/--config`, `--image`, `-j/--json`) — it has no
subcommands at all, so `flyctl releases rollback` and `flyctl releases list`
both just print usage and exit non-zero.

Both were previously used throughout this runbook, and `flyctl releases
rollback` was also the implementation of the deploy workflow's
auto-rollback-on-smoke-failure step — meaning **that automatic rollback could
never have worked**. Fixed 2026-09-26.

| Wrong | Right |
|---|---|
| `flyctl releases list --app X` | `flyctl releases --app X` |
| `flyctl releases rollback --app X` | `flyctl deploy --config <cfg> --app X --image <ref>` |

---

## Fast image rollback

Rollback means **redeploying an image that already exists in the registry**. It
does not rebuild from source, so it cannot accidentally pick the bad commit up
again, and it is quick — ~65 s observed in production on 2026-09-26.

### 1. List releases with their images

```bash
flyctl releases --app school-kit-api --image
flyctl releases --app school-kit-render-worker --image
```

Output is one row per release with `VERSION`, `STATUS`, `DATE` and
`DOCKER IMAGE`. Pick the newest release whose status is `complete` and that
predates the bad deploy. Machine-readable form:

```bash
flyctl releases --app school-kit-api --image --json
```

Each element carries `Version`, `Status` and `ImageRef`.

### 2. Identify the target image

Either read it off the table above, or let the helper pick it:

```bash
# newest complete release (what is live now)
bash scripts/fly-rollback.sh current-image  school-kit-api

# the one before it — the usual rollback target
bash scripts/fly-rollback.sh previous-image school-kit-api
```

Both print `<version><TAB><imageRef>`. `previous-image` **refuses** to answer
when there is no distinct earlier image, rather than handing you a target that
would make the rollback a no-op.

> Do not assume `--json` ordering. The helper sorts by `Version` descending
> explicitly instead of trusting `.[0]`/`.[1]`, and you should read the
> `VERSION` column rather than assuming the top row — a silent ordering change
> upstream would otherwise send production to an arbitrary image.

### 3. Redeploy that image

```bash
bash scripts/fly-rollback.sh to-image \
  school-kit-api apps/api/fly.toml \
  registry.fly.io/school-kit-api:deployment-<ID>
```

or directly:

```bash
flyctl deploy \
  --config apps/api/fly.toml \
  --app school-kit-api \
  --image registry.fly.io/school-kit-api:deployment-<ID> \
  --wait-timeout 300
```

The render worker is a **separate app with its own release history** — its
version numbers are unrelated to the API's:

```bash
bash scripts/fly-rollback.sh to-image \
  school-kit-render-worker apps/api/fly-render.toml \
  registry.fly.io/school-kit-render-worker:deployment-<ID>
```

Note a rollback produces a **new, higher release number** carrying the older
image (rolling v277 back to v276's image created **v278**). "Current version
went up" is expected; check the `DOCKER IMAGE` column, not the number.

---

## Verification after rollback

```bash
# 1. the live release now carries the intended image
flyctl releases --app school-kit-api --image | head -3

# 2. machines are up and checks pass
flyctl status --app school-kit-api

# 3. liveness + DB role (the second asserts the runtime role is app_user,
#    i.e. RLS is still enforced — see CLAUDE.md's multi-tenancy hard rules)
curl -sS https://school-kit-api.fly.dev/api/v1/health
curl -sS https://school-kit-api.fly.dev/api/v1/health/db   # expect {"status":"ok","role":"app_user"}

# 4. full smoke sequence
SMOKE_API_URL=https://school-kit-api.fly.dev bash scripts/smoke-test.sh

# 5. logs
flyctl logs --app school-kit-api --no-tail
```

For the render worker, a `stopped` machine is its **correct idle state**
(scale-to-zero, `min_machines_running = 0`) — not a rollback failure. Confirm
the release instead:

```bash
flyctl releases --app school-kit-render-worker --image | head -3
```

---

## Caveats — what an image rollback does NOT undo

An image rollback reverts **code only**. It is not a time machine.

- **Database migrations are not reverted.** `prisma migrate deploy` has already
  applied them and there is no down-migration. Old code against a newer schema
  is usually tolerable (additive migrations) but is *not* guaranteed — a
  destructive migration (dropped/renamed column) will break the rolled-back
  code. Schema problems need their own forward-fix migration.
- **`prisma migrate deploy` does not wrap multiple migrations in one
  transaction.** If the runner died mid-deploy, some may have applied and
  others not. Diagnose with the `_prisma_migrations` query below.
- **Secrets and config are not reverted.** `flyctl secrets set`, `fly.toml`
  `[env]` changes and Upstash/Neon settings are all outside the image. Revert
  those deliberately and separately.
- **Data written by the bad release stays written.** Rolling back stops the
  bleeding; it does not undo rows. Use Neon PITR (failure class 3).
- **API and render worker are independent.** Each has its own history and may
  need its own target. Do not assume matching version numbers.
- **The queues are not drained.** Jobs enqueued by the bad release are still in
  Redis and will be consumed by the rolled-back code. Consider whether their
  payloads are still valid.

---

## Before you start: find the failed deploy

```bash
flyctl releases --app school-kit-api --image
# Look for the last failed release, or the one the smoke test rejected.
```

---

## Failure class 1 — Deploy failure (Fly never finished)

**Symptom:** `flyctl deploy` exits non-zero; the machine never became healthy;
the smoke test never ran. The previous release is still serving traffic.

**Action:** Nothing to roll back — the new code never took over.

```bash
flyctl releases --app school-kit-api --image
flyctl status --app school-kit-api
```

**Root causes to investigate:**
- Docker build failure → check the GitHub Actions build log.
- Image push timeout → re-run the deploy workflow manually.
- Machine OOM on startup → check Fly metrics for the new machine.

**Render worker:** Same pattern; check `school-kit-render-worker` separately.
Note the workflow deploys the API *first*, so an API failure means the worker
was never touched, while a worker failure means the API already advanced.

---

## Failure class 2 — Migration failure (deploy finished, smoke op 3 fails)

**Symptom:** Deploy succeeded (Fly reported healthy), but the smoke test's
`POST /auth/signup-owner` returned a non-201 — typically a 500 because a table
or column from a new migration is missing.

**Automatic rollback:** the deploy workflow's `Roll back on smoke failure` step
redeploys the images both apps were serving *before* the run, captured by the
`Capture pre-deploy images` step that runs before any deploy. Verify:

```bash
flyctl releases --app school-kit-api --image | head -3
flyctl releases --app school-kit-render-worker --image | head -3
flyctl status --app school-kit-api
```

If the workflow logged `ROLLBACK DID NOT COMPLETE CLEANLY`, treat it as a live
incident and roll back by hand using **Fast image rollback** above.

### If the deploy aborted at `Capture pre-deploy images`

That step is **fail-closed on purpose**: it refuses to deploy when it cannot read
a rollback target. It aborts on a flyctl error (expired `FLY_API_TOKEN`, network
failure, Fly API outage, unknown app), an unparseable response, or an empty
release history — because "we could not read the current image" must not be
treated the same as "there is nothing to read". Deploying anyway would mean
shipping with no deterministic way back.

Nothing was deployed when this fires, so there is nothing to roll back. Fix the
cause and re-run:

```bash
flyctl auth whoami                                   # token still valid?
flyctl releases --app school-kit-api --image | head  # can you read releases?
bash scripts/fly-rollback.sh capture school-kit-api  # what the workflow runs
```

The only way past it is the deliberate `allow_missing_rollback_target` input on
a manual `workflow_dispatch` run, which downgrades the abort to a warning. That
exists for a **first-ever deploy of a brand-new Fly app**, where there genuinely
is no prior image. `school-kit-api` and `school-kit-render-worker` are long
established, so for them an empty history is an anomaly to investigate — do not
reach for this input to push a deploy through.

**Why migrations can leave things in a broken state:** see Caveats.

**Diagnose:**
```bash
psql "$STAGING_DIRECT_URL" -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 10;"
```

**Fix:**
1. Identify which migration failed (NULL `finished_at`).
2. Fix the migration SQL or the schema, and push a corrected commit.
3. On the next deploy, `prisma migrate deploy` will retry the failed migration.

**DO NOT manually edit `_prisma_migrations`.** Let Prisma manage its own state
table; manual edits break the migration history.

---

## Failure class 3 — Data-corruption failure (smoke passes, incident flagged manually)

**Symptom:** The smoke test passed, traffic switched, but you discover corrupted
or inconsistent data in the application (e.g., a fee calculation is wrong, a
tenant isolation boundary was crossed, audit logs are missing).

**This is a manual incident.** There is no automatic rollback for data issues.

**Step 1: assess blast radius.** How many schools / records are affected?

**Step 2: roll back the code** if the corruption is caused by the new code —
use **Fast image rollback** above. This puts the old code on traffic; the
corrupted data is still there.

**Step 3: recover data via Neon point-in-time recovery (PITR).**

`Neon dashboard → your project → Restore`. Select a timestamp before the
corrupted writes and restore to a new branch, inspect it, then promote it or
copy the specific rows back.

> Check the project's current Neon plan before relying on this: the restore
> window is plan-dependent and is only hours on the Free plan.

**Step 4: write an incident report** in `docs/customer-conversations/` or a
dated journal entry. Capture what happened, what data was affected, and what
the fix was. If the bug is in RLS or tenant isolation, escalate immediately —
cross-tenant data exposure is a GDPR/NDPR incident.

---

## Quick-reference commands

```bash
# List releases WITH their image refs (no `list` subcommand — just `releases`)
flyctl releases --app school-kit-api --image
flyctl releases --app school-kit-render-worker --image

# Roll back to a specific image (there is no `releases rollback`)
bash scripts/fly-rollback.sh previous-image school-kit-api
bash scripts/fly-rollback.sh to-image school-kit-api apps/api/fly.toml <imageRef>
bash scripts/fly-rollback.sh to-image school-kit-render-worker apps/api/fly-render.toml <imageRef>

# Machine health
flyctl status --app school-kit-api

# Logs (--no-tail for the buffer; omit to stream)
flyctl logs --app school-kit-api --no-tail

# Smoke test manually
SMOKE_API_URL=https://school-kit-api.fly.dev bash scripts/smoke-test.sh
```

---

## Note: the render worker wake URL is a PUBLIC hostname

`RENDER_WORKER_URL` is set in `apps/api/fly.toml`'s `[env]` block to
`https://school-kit-render-worker.fly.dev` — deliberately **not** the
`.internal` form. `.internal` DNS only publishes RUNNING machines and bypasses
Fly Proxy, which is the component that performs `auto_start_machines`, so it
cannot wake a stopped worker. See that file's comment for the full reasoning.

**The smoke test (`scripts/smoke-test.sh`) does not call the render worker.**
It exercises the API only, so the worker being stopped (scale-to-zero) does not
affect the smoke result.

To verify the render worker from outside Fly:
```bash
flyctl ssh console --app school-kit-render-worker
curl http://localhost:4001/health
```
