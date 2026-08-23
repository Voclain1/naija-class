# Legacy invoice arm backfill

Historical finance attribution uses `Invoice.classArmId`, frozen when the
invoice is issued. Existing invoices may be null until an operator reviews and
backfills one school at a time.

## Dry-run first

```bash
pnpm api:backfill-invoice-arms -- --school-id <school-uuid>
```

Review `candidateCountByArm` and every unresolved row. The tool only proposes
an exact student/term enrollment that already existed at invoice time and has
no audited arm change after issuance. Missing, later-created, or transferred
enrollments remain explicitly unresolved; they are never guessed.

## Apply the reviewed plan

```bash
pnpm api:backfill-invoice-arms -- --apply \
  --school-id <school-uuid> \
  --confirm-school-id <same-school-uuid> \
  --actor-user-id <active-platform-admin-user-uuid> \
  --actor-school-id <operator-school-uuid>
```

Apply requires an active platform administrator and exact typed school
confirmation. All candidate writes run in the tenant transaction, reconcile
planned count to updated count, and create exactly one actor-attributed
`invoice-arm.backfilled` audit row. Unresolved invoices stay null and will be
reported as the explicit legacy/unassigned group by the dashboard.
