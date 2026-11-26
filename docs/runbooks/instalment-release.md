# Instalment payment release on the VPS

This procedure covers #567 and #566 as one application cutover. Keep
`VPS_DEPLOY_ENABLED=false` and the generic VPS workflow disabled. Its manual
dispatch bypasses the variable. Use the deployed configuration and backup
override. Keep both deployment and unified messaging cutover approvals separate.

## Release and recovery gates

- Review and merge #567 first. Rebase #566 on the resulting main and verify its
  exact head. Identify the final merged commit and every pending migration.
- Use the existing API and Next Dockerfiles to build API, web and portal from
  that commit on hosted or approved build capacity. Supply the approved public
  web and portal build configuration. Record and pull immutable GHCR digests.
- On PostgreSQL 18 with pgvector and fictional baseline data, apply migrations
  with the migration role. Run the applications using the runtime role and
  FORCE RLS. Verify that full, partial, unapplied and reversed payments retain
  their invoice state and receipt identifiers. Verify stale links, duplicate
  callbacks, out-of-order targets and existing cancelled invoice replacements.
- Rehearse the same checks after switching to a separately pinned recovery
  API image on the **same migrated database**. After #567, a recovery API must
  preserve gross receipts and apply only allocated amounts. After #566 it must
  also preserve target IDs across checkout, settlement, links, refunds and
  receipts. Neither the pre-#567 API nor an allocation-only #567 image is a
  post-#566 write recovery target. A prior Batch 2 recovery image is eligible
  only after proving the same target-aware behavior. A source inspection or
  green build does not qualify a recovery image.
- Record which services can write finance data or consume finance jobs. Include
  any such workers in the drain and use compatible images before reopening
  their queues. Pin all required recovery images locally and remotely.
- If no compatible recovery API has passed rehearsal, keep the release on hold.
  If an incident occurs after cutover, pause finance writes and callbacks with
  retryable errors and prepare a forward fix on the target-aware release.
  Recover accepted events through the compatible API using authenticated
  provider verification and existing deduplication. Preserve all database
  rows, migration state and receipt storage. Keep FORCE RLS in force.

## Scoped switch

1. Confirm a maintenance window and secure database backup with a checksum.
   Capture the current app and protected container IDs, image digests, start
   times, and protected configuration file checksums without printing secrets.
   Record the last successful backup heartbeat.
2. Stage a root-readable Compose override under the existing project directory.
   It changes only `services.api.image`, `services.web.image` and
   `services.portal.image` to approved digests. Include the existing
   `backup-ops.override.yml` in the Compose invocation. Keep the existing env
   files. Inspect only the effective service names and image references.
3. Arrange retryable failures for unavailable Paystack callbacks and drain API
   writes and affected workers. Stop the old API before applying migrations.
   Use the exact release checkout's Prisma CLI and the protected migration
   connection. Execute `pnpm --filter @school-kit/db exec prisma migrate deploy`
   and `prisma migrate status` through the approved administration path.
4. With the original project name, env file and protected overrides, use
   `docker compose … pull api web portal` and
   `docker compose … up -d --no-deps --no-build api web portal`.
   Keep the generic deploy script, broad rebuilds, orphan removal and image
   pruning out of this procedure. Update any drained finance worker only
   after checking its compatibility and documenting its specific image.
5. Check API health at `http://127.0.0.1:4000/api/v1/health`, web and portal
   health on ports 3001 and 3002, and the public routing. Confirm PostgreSQL,
   Redis, ops-pinned, non-target applications, backup overrides and protected
   configuration match the captured IDs, checksums and start times. Compare
   running image digests with the release manifest.
6. Resume traffic after the health and runtime-role gates pass. Exercise the
   isolated fictional payment and receipt flow with mocked provider evidence.
   In production, verify callback health, settlement exceptions and backup
   scheduling read-only. Record results for the next scheduled backup.
7. If rollback is required, repeat the scoped switch using only the qualified
   recovery digest set. Verify receipt identifiers, invoice balances, targets,
   exception history and callback recovery before resuming writes. Restore a
   database only under a separate disaster-recovery plan that preserves newer
   verified transactions.

## Reconcile #563 later

Preserve every applied migration identity and checksum. The finance-only
`20270118120000_paystack_reconciliation_cases` from #567 is canonical.
Place the two wallet recovery columns originally in #563's mixed migration
in a separate wallet-only migration when reconciling that unmerged branch.
Reuse the existing link validity, allocation, invalidation and review
migrations. The two #566 migrations own instalment targets and requests.
Test deployment order on PostgreSQL 18 from a pre-release schema and verify
that Prisma reports all migrations applied exactly once.
