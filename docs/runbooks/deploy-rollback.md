# Deploy rollback runbook

This runbook covers the three failure classes after a staging deploy and tells
you what to do for each one.

---

## Before you start: find the failed deploy

```bash
flyctl releases list --app school-kit-api
# Look for the last FAILED or the release that the smoke test rejected.
# Each release has a version number (v1, v2, …).
```

---

## Failure class 1 — Deploy failure (Fly never finished)

**Symptom:** `flyctl deploy` exits non-zero; the machine never became healthy;
the smoke test never ran. The previous release is still serving traffic.

**Action:** Nothing to roll back — the new code never took over.

```bash
# Confirm the current release is still the old one:
flyctl releases list --app school-kit-api
flyctl status --app school-kit-api
```

**Root causes to investigate:**
- Docker build failure → check the GitHub Actions build log.
- Image push timeout → re-run the deploy workflow manually.
- Machine OOM on startup → check Fly metrics for the new machine.

**Render worker:** Same pattern; check `school-kit-render-worker` separately.

---

## Failure class 2 — Migration failure (deploy finished, smoke op 3 fails)

**Symptom:** Deploy succeeded (Fly reported healthy), but the smoke test's
`POST /auth/signup-owner` returned a non-201 — typically a 500 because a table
or column from a new migration is missing.

**Automatic rollback:** The deploy workflow already ran:
```
flyctl releases rollback --app school-kit-api
```
Verify it completed:
```bash
flyctl releases list --app school-kit-api
# The active release should now be the previous version.
flyctl status --app school-kit-api
```

**Why migrations can leave things in a broken state:**
`prisma migrate deploy` applies migrations one at a time and does NOT wrap
multiple migrations in a single transaction. If the runner died mid-deploy,
some migrations may have applied and others not.

**Diagnose:**
```bash
# Connect to Neon as school_kit (migration role) and check migration state:
psql "$STAGING_DIRECT_URL" -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at DESC LIMIT 10;"
```

**Fix:**
1. Identify which migration failed (NULL `finished_at`).
2. Fix the migration SQL or the schema, and push a corrected commit.
3. On the next deploy, `prisma migrate deploy` will retry the failed migration.

**DO NOT manually edit `_prisma_migrations`.** Let Prisma manage its own
state table; manual edits break the migration history.

---

## Failure class 3 — Data-corruption failure (smoke passes, incident flagged manually)

**Symptom:** The smoke test passed, traffic switched, but you discover corrupted
or inconsistent data in the application (e.g., a fee calculation is wrong, a
tenant isolation boundary was crossed, audit logs are missing).

**This is a manual incident.** There is no automatic rollback for data issues.

**Step 1: assess blast radius.** How many schools / records are affected?

**Step 2: roll back the code** if the corruption is caused by the new code:
```bash
flyctl releases rollback --app school-kit-api
# This puts the old code on traffic. The corrupted data is still there.
```

**Step 3: recover data via Neon point-in-time recovery (PITR).**

Neon supports PITR on all plans. Go to:
`Neon dashboard → your project → Restore`

Select a timestamp before the corrupted writes and restore to a new branch.
Then inspect the branch to verify the data, and (if correct) promote it to
main or copy the specific rows back.

**Neon PITR docs:**
See the Neon documentation for "Branch restore" / "Time Travel" — the exact
UI may change; the concept is restoring a database branch to a past timestamp.

**Step 4: write an incident report** in `docs/customer-conversations/` or a
dated journal entry. Capture what happened, what data was affected, and what
the fix was. If the bug is in RLS or tenant isolation, escalate immediately —
cross-tenant data exposure is a GDPR/NDPR incident.

---

## Quick-reference commands

```bash
# List releases
flyctl releases list --app school-kit-api
flyctl releases list --app school-kit-render-worker

# Roll back to previous release
flyctl releases rollback --app school-kit-api
flyctl releases rollback --app school-kit-render-worker

# Check current machine health
flyctl status --app school-kit-api

# Tail live logs
flyctl logs --app school-kit-api

# Run smoke test manually against staging
SMOKE_API_URL=https://school-kit-api.fly.dev bash scripts/smoke-test.sh
```
