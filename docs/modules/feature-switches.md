# Feature switches

**Status:** built 2026-11-06 (plan items FD-1a and FD-1b in
`docs/reviews/agentic-implementation-plan.md`). Not merged or deployed until the
owner approves. **Every switch is off for every school.** Nothing reads a
switch yet: the first reader will be the help assistant (plan item 4A), which
is not built.

## Purpose

This gives the platform operator one way to turn a feature on for one school
at a time: the pilot step of the plan's rollout ladder. Until now each
per-school rollout added its own `School` boolean (`aiEnabled`,
`smartImportEnabled`, `staffMobileEnabled`…). The agentic plan expects a dozen
or more pilot features, so they share one column and one endpoint.

## Rules

1. **Off by default.** A key with no entry, or anything other than `true`,
   reads as off. No migration or seed turns a key on.
2. **The platform wins.** A key listed in the API's `FEATURES_DISABLED`
   variable (comma-separated, or `*`) is off for every school, whatever the
   school's entry says.
3. **The key list is code.** Keys are `FEATURE_KEYS` in `@school-kit/types`.
   An unknown key is refused on write (400) and ignored on read, so a stale or
   hand-written entry never switches anything on.

## Data

| Column | Type | Notes |
|---|---|---|
| `schools.feature_switches` | `JSONB NOT NULL DEFAULT '{}'` | `CHECK (jsonb_typeof(...) = 'object')`. Always read through `parseFeatureSwitches`. |

**Why a column on `schools` rather than a table** (owner's instruction
2026-11-06: "use the proposed JSONB approach if repository checks support
it"). The repository checks that supported it:
- `schools` has no RLS policy, being the tenant table, so the operator's
  cross-tenant read and write need no new SECURITY DEFINER function.
- JSON columns are an established pattern (`import_jobs.column_mapping`,
  `audit_logs.metadata` and others).
- Prisma's schema diff shows no drift for the new column.

A FORCE-RLS table would have needed a SECURITY DEFINER read for the platform
list.

`platform_admin_list_schools()` returns `feature_switches` (11th revision,
migration `20261203120000_school_feature_switches`). The SECURITY DEFINER count
stays 23.

## Keys

| Key | Label | Gates | State |
|---|---|---|---|
| `assistant-help` | Help assistant | The staff help and settings assistant (plan 4A) | Not built; off everywhere |
| `assistant-billing` | Invoice assistant | Term invoice preparation and approval (`docs/modules/assistant-billing.md`) | Built; off everywhere |
| `student-intake` | Reviewed student intake | Prepare, review and confirm a student batch (`docs/modules/student-intake-proposals.md`); no model. `POST /students/bulk` is not behind it | Backend built; off everywhere |
| `reminder-campaigns` | Fee reminder campaigns | Reviewed, journaled fee reminder campaigns (`docs/modules/reminder-campaigns.md`); no model. Off halts running campaigns before their next send. `POST /finance/debtors/remind` is not behind it | Backend built; off everywhere |
| `student-corrections` | Reviewed student corrections | Reviewed batch corrections to names, date of birth, gender and email (`docs/modules/student-corrections.md`); no model. `PATCH /students/:id` is not behind it | Backend built; off everywhere |
| `assistant-workspace` | SchoolKit Assistant | The staff assistant panel (`docs/modules/assistant-workspace.md`); no model. Each task also needs its own switch (`assistant-billing`, `reminder-campaigns`, `student-intake`, `student-corrections`) | Built; off everywhere |
| `assistant-model-routing` | SchoolKit Assistant: AI understanding (pending approval) | Sends staff requests to the `assistant-orchestrator` prompt (`docs/modules/assistant-workspace.md`, "Model orchestration"). Its allowlist row is NOT approved; production refuses it until `ASSISTANT_ORCHESTRATOR_APPROVAL` is "approved". Needs `assistant-workspace` and AI on for the school | Built; off everywhere; do not switch on |

## API

`PATCH /api/v1/platform-admin/schools/:schoolId/features` (`PlatformAdminGuard`,
20 requests a minute)

```json
{ "key": "assistant-help", "enabled": true }
```

The response is `{ schoolId, featureSwitches }`, every known key resolved.

**Write:**
- One key per request.
- The merge (`feature_switches || jsonb_build_object(...)`) runs under
  `SELECT … FOR UPDATE`, so concurrent writes to different keys never lose
  each other. Keys the build does not know are preserved but never read.

**Audit:** one row per write, including a write of the value already held:
- action `platform_admin.schools.set-feature`;
- `schoolId` null, `entityType` `school`, `entityId` the school;
- metadata `{ field: "featureSwitches", key, from, to }`.

**Read:** `GET /platform-admin/schools` rows carry `featureSwitches`. The
`FEATURES_DISABLED` variable is deliberately not reported, as `aiEnabled` does
not report `AI_ENABLED`.

## Resolver

`FeatureSwitchesService.isOn(schoolId, key)`
(`apps/api/src/common/features/`) is the only way code asks whether a feature
is on. Import `FeatureSwitchesModule` explicitly; it is not global.

- **Reads:** under `withTenant`, so the file is not on the `basePrisma`
  allowlist.
- **Cache:** 30 s in-process. A platform-admin write invalidates the entry in
  the process that served it. Other API processes see a change within 30 s,
  which is the documented staleness of switching a feature off.
- **A read that overlaps a write:** each `invalidate()` bumps a per-school
  generation, and a read caches its result only if the generation is the same
  when it finishes as when it began. Otherwise a read that fetched the old
  value before the write could cache it after the write, and a switch turned
  off would stay on for a full TTL (fixed 2026-11-07; the spec holds a read
  open across a write and fails without the guard).
- **Unknown school:** reads as all off.
- **`FEATURES_DISABLED`:** read once at start. It is the immediate,
  all-process kill.

## Operator UI

The school's Manage dialog has a **Pilot features** section with one row per
key, except the SchoolKit Assistant's six keys. Those have their own
**SchoolKit Assistant** section, which also shows whether each one is
actually working and why not (`docs/modules/assistant-workspace.md`,
"Controlled activation"; `GET /platform-admin/schools/:schoolId/assistant`).
One write is refused: in production, `assistant-model-routing` cannot be
switched on while its prompt's approval is pending (409
`ASSISTANT_MODEL_NOT_APPROVED`). Turning a key on asks for confirmation; turning it off does not. The
platform audit page shows "Turned Help assistant on/off".

## Tests

- `apps/api/src/common/features/feature-switches.service.spec.ts`:
  - the rules (defaults, unknown keys, the precedence matrix, env parsing,
    write validation);
  - against real Postgres: per-school reads with no leak between schools;
  - the env override;
  - an unknown school;
  - the cache proven to skip the database while warm, with invalidate and
    expiry;
  - the CHECK constraint.
- `apps/api/src/__tests__/platform-admin-access.spec.ts`, "PATCH
  /platform-admin/schools/:schoolId/features":
  - 403 for the school's own owner, admin, teacher and bursar, with nothing
    changed;
  - 401 without a session;
  - on and off for one school only, read back through the list, with
    from/to/key audit rows and the resolver seeing the change at once;
  - a write of the value already held is audited;
  - unknown keys are preserved;
  - 400 for an unknown key, a non-boolean, an extra field or an empty body;
    404 for an unknown school.
  - The row allow-list now includes `featureSwitches`.
- `apps/web/src/components/super-admin/audit-entry.spec.ts`: the audit
  sentence.

## Rollback

- **Switch off:** `PATCH … { enabled: false }` for one school, or
  `FEATURES_DISABLED=*` and a restart for all.
- **Revert:** reverting the code leaves the column (additive) and the 11th
  revision of the list function. Rows are ignored by older code, whose
  `SELECT *` mapping does not read the extra column.

## Onboarding guide

No change: schools see nothing new, and every switch is off.
