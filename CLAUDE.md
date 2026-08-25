# CLAUDE.md

This file tells Claude Code how School Kit is built. Read it before doing anything in this repo.

## Project

School Kit — multi-tenant school management platform for Nigerian private schools. Solo build with Claude Code. AI-assisted learning is a first-class feature, not an add-on.

## Read first (in this order)

1. `docs/ARCHITECTURE.md` — system overview
2. This file (`CLAUDE.md`)
3. The relevant `docs/modules/<module>.md` for the work at hand

If the work touches multi-tenancy, money, or AI, also read the "Hard rules" section below carefully — those are the failure modes that will cause real damage.

## Tech stack (exact versions)

- Node.js: 22.x LTS
- pnpm: 9.x
- TypeScript: 5.6+
- Next.js: 15.x (App Router, React Server Components)
- React: 19.x
- NestJS: 10.x
- Prisma: 5.x
- PostgreSQL: 16.x (with `pgvector` extension)
- Redis: 7.x
- Expo SDK: 57.x (React Native 0.86.x, React 19.2.x — upgraded from SDK 52 in
  Phase 6 / Slice 1, 2026-08-15. SDK 52 was the last SDK on React 18, so this
  is also what aligned `apps/mobile` with the monorepo's React 19.)
- Tailwind CSS: 3.4+
- shadcn/ui: latest
- Anthropic SDK (`@anthropic-ai/sdk`): latest
- Better Auth: latest
- BullMQ: latest

When upgrading any of these, update this file in the same PR.

## Monorepo layout

```
apps/
  web/      Next.js — admin + teacher
  portal/   Next.js — parent portal (Phase 4), own Vercel project + deploy
  mobile/   Expo — parent + student
  api/      NestJS — backend
packages/
  db/       Prisma schema and client
  types/    Shared TypeScript types and Zod schemas
  ui/       Shared React components
  ai/       Claude prompts, RAG helpers, evals
  config/   Shared tsconfig, eslint, tailwind presets
docs/
  ARCHITECTURE.md
  modules/  Per-module specs (one per Phase or feature)
infra/      Terraform / Pulumi
```

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Files | `kebab-case.ts` | `students.controller.ts` |
| Classes | `PascalCase` | `StudentsController` |
| Functions / variables | `camelCase` | `getStudentById` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_FILE_SIZE` |
| DB tables | `snake_case`, plural | `students`, `class_arms` |
| DB columns | `snake_case` | `school_id`, `created_at` |
| Prisma models | `PascalCase`, singular | `Student`, `ClassArm` |
| API routes | `kebab-case`, plural | `/api/v1/students`, `/api/v1/class-arms` |
| React components | `PascalCase.tsx` | `StudentCard.tsx` |
| Env vars | `SCREAMING_SNAKE_CASE` | `ANTHROPIC_API_KEY` |
| Test files | sibling, `.spec.ts` or `.test.ts` | `attendance.service.spec.ts` |
| Git branches | `<phase>/<module>` | `phase-2/attendance` |

## Hard rules — never do these

### Multi-tenancy

- **Never query without a `school_id` filter.** Use `getTenantPrisma(schoolId)` from `packages/db/src/tenant-client.ts`. Raw SQL must `SET LOCAL app.current_school_id` first.
- Never expose any ID from one school to a user from another. Re-validate `school_id` against the JWT on every endpoint that takes an ID in the path or body.
- Never log full user PII in production. Email, phone, BVN, NIN all get redacted by the logger; if you bypass the logger you're doing it wrong.
- **Runtime DB role must NOT have SUPERUSER or BYPASSRLS.** Postgres silently skips RLS policies for privileged roles, even with FORCE ROW LEVEL SECURITY. The runtime app connects as `app_user` (no privileges beyond SELECT/INSERT/UPDATE/DELETE on `public`). Migrations connect as `school_kit` via `DIRECT_URL`. If `DATABASE_URL` is ever changed to a privileged role, the RLS spec must fail loudly — this is a feature, not a bug.

### Money

- Never use `Float` or `Number` for money in the DB or in TypeScript. Money is `Int` (kobo) in the DB and `bigint` in TS. Format to naira only at the display layer.
- Never compute fees, discounts, or balances in the frontend. The frontend displays what the API returned, full stop.
- Every payment-mutating action goes through `FinanceService` and writes to `audit_logs`. No exceptions, including admin overrides.

### Auth

- Never trust the JWT subject alone for mutations. Re-fetch the user (and verify `is_active`) on every write.
- Never include secrets, BVN, full passwords, or OTP codes in any log, error message, or response body.
- Never roll your own crypto. Use Better Auth primitives.

### AI

- Never auto-finalise AI output for grades, report card comments, or behaviour records. There is always a teacher-approval gate.
- Never send student PII (full name, address, DOB, contact info) to the LLM **for derived features** — comments, summaries, insights, tutoring. Use opaque IDs and class-level context (e.g. "JSS2 student") only. The single exception is the named-prompt allowlist below; it is an allowlist of *prompt names*, not a category, and nothing joins it without its own sign-off.
- Every call to `claudeClient.messages.create` must log to the `ai_generations` table: model, prompt name + version, input/output tokens, latency, cost estimate, success/error.
- Per-school monthly token budget enforced before the call, not after.

**The PII-bearing prompt allowlist (approved 2026-08-20).** Exactly one prompt
is permitted to send student PII to the model:

| Prompt name | Feature | Why the PII *is* the payload |
|---|---|---|
| `student-list-extraction` | Smart Student Import (`docs/modules/smart-student-import.md`) | The feature transcribes a register the school already holds and already has the data in. Opaque IDs are not merely worse here — there is nothing to make opaque, because the transcription is the product. |

Two rules bind every prompt on this list, and they are what make membership
survivable:

1. **The transcribed data is never retained by the model path beyond the
   single request.** No storage object, no queue payload, no cache. See D3 in
   the module doc.
2. **The extraction never writes to a student record without explicit human
   confirmation.** Same gate as D15's report comments.

**This is an allowlist of one prompt name, deliberately — not a new
category.** The distinction is load-bearing: a category ("transcription
features", "onboarding features") is something a future prompt could argue
itself into during review. A named list cannot be joined by accident — adding
a second row is a visible edit to this file, and the eval suite pins the list
so an unlisted prompt carrying PII fails CI rather than shipping. If a future
feature needs this, it earns its own row and its own sign-off. Do not
generalise this table into a rule.

**`AIInteractionLog` (`ai_interaction_logs`, shipped Phase 1 / Slice 12) vs
`AIGeneration` (`ai_generations`, not yet built — Phase 5) are deliberately
two different tables, not a naming drift to reconcile** (resolved 2026-07-26,
closing the blocker tracked in `docs/deferred.md`). `AIInteractionLog` is a
session/interaction **content** record — `sessionRef` groups rows into a
conversation or feature-level interaction, `studentId` is nullable
(teacher-driven sessions have no student), `payload` is a loose, PII-free
JSON envelope. `AIGeneration` is the per-call **cost/compliance ledger** the
hard rule above mandates — one flat, typed row per `claudeClient.messages.create`
call (model, prompt name + version, token counts, latency, cost, success/
error), shaped for the budget-enforcement query that rule requires, not for
holding conversation content. A single tutor session (one `AIInteractionLog`
group) will span multiple underlying calls, each logged separately to
`ai_generations`. Do not rename or merge one into the other. `AIGeneration`'s
exact schema — including the cost-estimate currency/unit decision — is still
owned by Phase 5's own plan-first; see `docs/deferred.md` for the draft.

### Git

- Never commit to `main`. PR per module.
- Never commit `.env`, `.env.*`, secrets, `dist/`, `.next/`, `node_modules/`, or generated Prisma client.
- `.env.example` is committed and stays in sync with required keys.

## Coding patterns

### Prisma column types in raw SQL

When writing raw SQL (migrations with SECURITY DEFINER functions, custom queries via `$queryRaw`):
- Prisma `String @id` → PostgreSQL `TEXT`, not `uuid`
- Prisma `DateTime` → `TIMESTAMP(3)` (3-digit ms precision; matches Prisma's default)
- Prisma `DateTime @db.Date` → PostgreSQL `DATE` (no time-of-day) — use this for calendar dates: academic year start/end, term start/end, student `dateOfBirth`, enrollment `enrolledAt`-as-date, etc. Reserve plain `DateTime` for true moments (`createdAt`, `updatedAt`, `acceptedAt`, `withdrawnAt`-as-event). The semantic difference matters because `DATE` doesn't store a timezone and avoids the "midnight in which zone?" trap when an admin in Lagos sets "term ends 2026-07-31" — the row stores the date, full stop. Convention established in Phase 1 / Slice 1 (2026-05-22); subsequent Phase 1 slices follow.
- Prisma `Boolean` → `BOOLEAN`
- Prisma `Int` → `INTEGER`
- Prisma `Json` → `JSONB`

If you need a uuid column specifically, declare it in Prisma as `String @id @db.Uuid`. Check `prisma migrate dev --create-only` and inspect the generated SQL before assuming.

### package.json `exports` maps are exhaustive

When adding an `exports` map to a shared package (`packages/config`, etc.), 
list every export the package needs to provide — not just the new ones. 
Exports maps are exhaustive: any path NOT listed becomes inaccessible 
to consumers. Symptoms include tsconfig `extends` silently falling back 
to TypeScript's defaults (producing misleading errors about 
esModuleInterop and similar). Always verify with `pnpm typecheck` 
after touching exports maps.

### SECURITY DEFINER functions — index

SECURITY DEFINER SQL functions bypass RLS by running with the privileges of the function owner (the migration role, `school_kit`). They are the only legitimate escape hatch from FORCE RLS for the runtime role (`app_user`), so they are load-bearing security primitives — treat every one as you would a piece of auth code, not as a generic helper.

Discipline for every function in this category:

1. Owned by the migration role; runtime role has EXECUTE only (PUBLIC revoked).
2. `SET search_path = public, pg_temp` pinned in the function body.
3. Returns scalars / opaque ids only — never a full row, never PII the caller didn't supply.
4. Has a header comment in the migration explaining (a) **why** SECURITY DEFINER is needed, (b) what fields it returns, and (c) what fields are **deliberately NOT** returned.
5. Added to the inventory below in the same PR that introduces it.

| Function | Migration | Purpose | Deliberately omits |
|---|---|---|---|
| `auth_check_signup_uniqueness(email, phone)` | `20260515000000_add_signup_uniqueness_function` | Distinguishes `EMAIL_TAKEN` vs `PHONE_TAKEN` at signup (FORCE RLS strips P2002 target). | Row ids, names, school_id — returns only two booleans. |
| `auth_resolve_session(token_hash)` | `20260516000000_add_auth_lookup_functions` | AuthGuard session lookup pre-tenant; resolves bearer token to `{ session_id, user_id, school_id, expires_at, user_is_active }`. | `password_hash`, email/phone/names, roles/permissions. |
| `auth_lookup_user_for_login(email)` | `20260516000000_add_auth_lookup_functions` | Login service user lookup pre-tenant; returns `{ user_id, school_id, password_hash, is_active }`. | phone, names, role grants, session rows. |
| `auth_resolve_invitation_by_token_hash(token_hash)` | `20260517000000_invitation_names_and_lookup` | Public invitation endpoints (GET /invitations/:token, POST /invitations/:token/accept) resolve a token hash to `{ invitation_id, school_id, email, role_key, first_name, last_name, invited_by, expires_at, accepted_at }` before withTenant() can apply. | `token_hash`, `phone`, `created_at` — caller already has the token; phone is Phase-4 territory; created_at is read tenant-scoped from the pending-invitations list. |
| `create_audit_log_partition(p_year, p_month)` | `20260628000000_phase_3_slice_3_audit_partitioning` | Called by `PartitionService` at startup and on the monthly cron; creates the named monthly child partition of `audit_logs`. `app_user` cannot `CREATE TABLE` directly; this runs as `school_kit`. | Returns VOID. Table name derived from integer arithmetic only; quoted via `%I` in the function body — no caller input reaches the DDL string. |
| `encrypt_bvn(p_bvn_plaintext)` | `20260708010000_phase_3_slice_12_bvn_encryption_functions` | Wraps `pgp_sym_encrypt` for staff BVN capture (`BvnService.captureBvn`). `pgp_sym_encrypt`/`pgp_sym_decrypt` have EXECUTE revoked from PUBLIC in the same migration, so this is the only path to producing BVN ciphertext. Pure crypto primitive — no table access, no school_id/user_id params; the row UPDATE stays ordinary `app_user` SQL under `withTenant`/RLS. | Nothing beyond the ciphertext — there is no row here. |
| `decrypt_bvn(p_bvn_encrypted)` | `20260708010000_phase_3_slice_12_bvn_encryption_functions` | Wraps `pgp_sym_decrypt` for `BvnService.revealBvn`. Same PUBLIC-revoked pgcrypto primitive as above. | Nothing beyond the plaintext BVN string — the service layer (not this function) is responsible for auditing every call and never logging the return value. |
| `auth_resolve_guardian_session(token_hash)` | `20260716000000_phase_4_slice_2_guardian_auth` | Portal AuthGuard-equivalent session lookup pre-tenant; resolves bearer token to `{ session_id, guardian_id, school_id, expires_at }`. | `password_hash`, email/phone/names. `guardian_sessions` has no `school_id` column (mirrors staff `sessions`); `school_id` comes from the join to `guardians`. |
| `auth_lookup_guardians_for_login(email)` | `20260716000000_phase_4_slice_2_guardian_auth` | **Multi-row**, unlike every other lookup function in this table. `Guardian.email` is unique only per-school (Decision C), so the same email can match guardians at multiple schools; the login service tries `argon2.verify` against each returned `password_hash` in turn (interim strategy, option ii, approved 2026-07-16 — see `docs/modules/phase-4.md` slice 2 plan-first). Returns `{ guardian_id, school_id, password_hash }` per match. | phone, names, `email_verified` (redundant — always true whenever `password_hash` is set). |
| `auth_resolve_guardian_invitation_by_token_hash(token_hash)` | `20260716000000_phase_4_slice_2_guardian_auth` | Public guardian portal invitation-accept endpoints resolve a token hash to `{ invitation_id, school_id, guardian_id, first_name, last_name, email, invited_by, expires_at, accepted_at }` before `withTenant()` can apply. Unlike the staff equivalent, contact fields are read via a join to `guardians` — `guardian_invitations` stores no redundant copies (Decision: option b, new parallel table, not a reuse of `invitations`). | `token_hash`, `phone`, `created_at`. |
| `auth_lookup_user_for_password_reset(email)` | `20260724000000_password_reset_tokens` | `POST /auth/forgot-password` looks up a user by email pre-tenant to `{ user_id, school_id, is_active }`. Deliberately separate from `auth_lookup_user_for_login` even though both key off email — that function returns `password_hash`, which forgot-password has no reason to ever hold. | `password_hash`, phone, names. |
| `auth_resolve_password_reset_token(token_hash)` | `20260724000000_password_reset_tokens` | `POST /auth/reset-password` resolves a token hash to `{ reset_id, user_id, school_id, expires_at, used_at }` before `withTenant()` can apply — same chicken-and-egg problem as invitation accept. | `token_hash`, email, names — the reset form has nothing to pre-fill. |
| `platform_admin_resolve_session(token_hash)` | `20260802000000_platform_admin` | PlatformAdminGuard's session lookup. Deliberately reuses the same `sessions` table every staff session lives in — the security boundary is the returned `is_platform_admin` column, re-read from `users` on every request, not a separate credential system. | `school_id` (platform-admin identity is cross-tenant by definition), `user_is_active` (no platform-admin deactivation flow exists yet — flagged, not built), `password_hash`, email/phone/names. |
| `platform_admin_list_schools()` | `20260802000000_platform_admin`; return shape extended `20260807000000_platform_admin_school_provisioning`, again `20260809000000_add_school_early_access_granted_at`, again `20260814000000_platform_admin_ai_toggle`, and again `20260825120000_platform_admin_staff_mobile_visibility` | Cross-tenant school roster for the platform-admin dashboard: `{ school_id, name, created_at, is_active, student_count, staff_count, owner_invite_pending, owner_invite_expires_at, early_access_granted_at, ai_enabled, staff_mobile_enabled }`. Aggregate counts only. `staff_mobile_enabled` (added 2026-08-25) is the per-school staff mobile rollout gate, surfaced for the same reason `ai_enabled` was — so `PATCH /platform-admin/schools/:schoolId/staff-mobile` is not a blind write — and clearing the omissions column on the same test: operator-set platform status about the tenancy, not the school's own configuration. Worth recording WHY it could not wait: the enable direction had an accidental substitute proof, since a successful staff mobile login is impossible while the flag is false (it is re-read at both password acceptance and challenge completion, returning `403 STAFF_MOBILE_DISABLED`), but a DISABLE had none — "nobody logged in" is not an observation, so a failed disable was indistinguishable from a successful one. A kill switch verifiable only in the direction that GRANTS access is the wrong way round. The dashboard renders this column read-only, deliberately unlike the AI toggle beside it: enablement runs through the one-school rollout rail (dry run plus an exactly-matching `--confirm-school-id`), and a one-click row toggle would quietly undo that friction. `ai_enabled` (added 2026-08-14) is the per-school AI kill switch, surfaced so `PATCH /platform-admin/schools/:schoolId/ai` isn't a blind write; it clears the omissions column on the same reasoning as `early_access_granted_at` — platform status about the tenancy, set by the operator, not the school's own configuration. `ai_monthly_token_budget` and `parent_summary_enabled` deliberately stay out: the first is spend configuration, the second is the school's own opt-in. The two `owner_invite_*` columns (added 2026-08-07) surface whether a school was provisioned via `POST /platform-admin/schools` and hasn't been accepted yet — deliberately not a new `SchoolStatus` value; see that PR's plan-first note. `early_access_granted_at` (added 2026-08-09) is a pure marker for future paid-tier grandfathering — nothing reads it to make a decision; it is commercial *status about the tenancy* (same category as `is_active`/`owner_invite_pending`), not the school's own financial configuration, which is why it doesn't breach the omissions column. | slug, address, phone, email, primaryColor, logoUrl, onboardingStep, ndprConsent, Paystack fields — none of this is "basic metadata"; financial/config detail is out of this surface's scope. |
| `platform_admin_list_users(school_id?)` | `20260802000000_platform_admin` | Cross-tenant (or single-school, when `p_school_id` is given) staff-account roster: `{ user_id, school_id, first_name, last_name, role_names, created_at, last_login_at, is_active }`. | email, phone, `password_hash`, totp*/bvn* fields, and — deliberately — `is_platform_admin` itself, so this read surface can't double as a way to enumerate who else holds platform-admin access. |
| `platform_admin_check_owner_email_available(email)` | `20260807000000_platform_admin_school_provisioning` | Pre-write availability check for `POST /platform-admin/schools` (school provisioning — the surface's first write). Returns `{ is_available, reason }`, checking both `users.email` (global uniqueness) and any live `owner`-role `invitations` row for that email across all schools. | Row ids, names, school_id — returns only a boolean and a discriminator string. |
| `platform_admin_list_paystack_setup_requests()` | `20260815000000_paystack_assisted_setup` | The platform operator's cross-tenant queue of schools awaiting a Paystack subaccount: `{ request_id, school_id, school_name, business_name, status, submitted_at, contact_name }`. Cross-tenant by definition ("every pending request, all schools") against a FORCE-RLS table whose policy keys off a single-school GUC — same constraint as the two list functions above. `business_name`/`contact_name` are not omission violations: the first is the school's own trading name shown to parents at Paystack checkout, the second identifies who to call; both are what make a row recognisable at a glance. | `account_number`, `bank_name`, `account_name`, `contact_email`, `contact_phone` — every banking/contact field. This list renders on page load for every pending request whether or not the operator is acting on one, so account numbers here would spread through logs, browser memory, and anything on screen on every visit. Revealing them is a separate, individually-audited call (`paystack-setup.reveal`) that runs under an ordinary GUC — **deliberately not a second SECURITY DEFINER function**, since once this list resolves a `school_id` a tenant exists and RLS governs the read normally. Mirrors `BvnService.revealBvn`. |
| `auth_resolve_student_session(token_hash)` | `20260815120000_phase_6_slice_3_student_portal_auth` | StudentAuthGuard's session lookup — the third principal (staff, guardian, student). Resolves a bearer token to `{ session_id, student_id, school_id, expires_at, student_status, portal_enabled }`. Returns **two** authority signals, deliberately: `student_status` is the SCHOOL's judgement about enrolment, `portal_enabled` (`password_hash IS NOT NULL`) is the GUARDIAN's about credentials. Neither subsumes the other — a parent switching off their child's account must not alter enrolment, and a school withdrawal must not depend on a parent acting. The guard refuses on either, which also makes guardian deactivation authoritative even if the session-row DELETE did not take effect. | `password_hash` itself (only the derived boolean leaves the DB); first/last name, DOB, photo, address, phone, email, blood group, medical notes, admission number. The guard runs pre-tenant and attaches its result to the request — this is the most PII-dense row in the schema and almost none of it is the guard's business. |
| `auth_lookup_student_for_login(school_slug, admission_number)` | `20260815120000_phase_6_slice_3_student_portal_auth` | Student login's pre-tenant lookup. Both `schools` and `students` must be read before a tenant is known: the caller supplies a school SLUG, so even the GUC's value is one of the things this resolves. **Single-row by construction** — `schools.slug` is globally unique and `students` carries `UNIQUE(school_id, admission_number)`. Deliberately does NOT copy `auth_lookup_guardians_for_login`'s multi-row shape or its argon2-verify loop: that exists only because `Guardian.email` is per-school unique, is documented as interim, and students cannot reproduce the ambiguity. Returns `{ student_id, school_id, password_hash, student_status, activated_at }`; `activated_at` is for AUDIT ONLY and must never change the response, since a divergent message is the enumeration leak this surface is most exposed to. | Names, DOB, contact details, medical notes — a login attempt is UNAUTHENTICATED, and admission numbers are sequential while school slugs are public, so returning PII here would hand it to anyone who can guess. Also the school's name/branding: nothing pre-auth needs it, and it would confirm a slug exists. |
| `auth_resolve_student_invitation(token_hash)` | `20260815120000_phase_6_slice_3_student_portal_auth` | Resolves the single-use portal invitation a GUARDIAN issues for their child, for the two public endpoints a child hits before holding any credential. **Liveness is enforced in SQL, not in the service**: the WHERE clause requires `accepted_at IS NULL AND revoked_at IS NULL`, which is the enforcement point for both of D26's guarantees — single-use (an already-accepted token, e.g. a forwarded screenshot, resolves to nothing) and burnable (deactivation stamps `revoked_at` and this function stops returning it in the same transaction). In the service layer a future second caller could forget it, and "single-use" would become a convention rather than a property. Expiry is deliberately NOT in the WHERE clause — `expires_at` is returned so the caller can distinguish EXPIRED from INVALID, matching every other resolver here. | `token_hash` (the caller holds it); `issued_by`; `accepted_at`/`revoked_at` (never non-NULL in a returned row). And **the student's name** — the sharpest omission here: the accept page would read better as "Set a password for Adaeze", but this endpoint is public and takes an attacker-supplied token, so a name turns a leaked or brute-forced token into a disclosure of which child it belongs to. The page says "your password"; the child knows who they are. |

**SECURITY DEFINER inventory audit (Phase 3 / Slice 12, 2026-07-08):** reviewed
all 5 pre-existing functions for consolidation when the count crossed the
"past 5" trigger. **Decision: keep all 5 as-is, no consolidation.** Each has a
deliberately narrow, non-overlapping return shape tailored to one caller
(`auth_lookup_user_for_login` returns `password_hash`, which the other three
auth functions correctly never see; `create_audit_log_partition` is a
different domain — DDL, not an RLS pre-tenant lookup). Merging any of them
would either widen a return row beyond what its caller needs or require a
branching "which entity type" argument — both weaken the "returns scalars
only, narrow to the one caller's need" discipline this table exists to
enforce. A dedicated `auth_service` schema/role (the other option
`docs/deferred.md` floated) was also rejected for this PR: it touches every
existing call site in the login/session path, unacceptable blast radius for a
refactor that isn't required to reduce count, only to review it.

The refactor actually delivered: **`apps/api/src/__tests__/security-definer-inventory.spec.ts`**
is a mechanical conformance gate, run on every CI pass, that queries `pg_proc`
for every function with `prosecdef = true` and asserts each one (a) appears in
the spec's `SECURITY_DEFINER_FUNCTIONS` constant — the single source of truth
this table and the spec both point at, so a new SD function added without
updating both fails loudly; (b) is owned by `school_kit`; (c) has
`search_path=public, pg_temp` pinned; (d) has EXECUTE revoked from `PUBLIC`
and granted to `app_user`. This replaces "if it grows past 5, refactor" — a
human-memory threshold — with a standing gate that holds at any count.
Table-review cadence: revisit this table's shape every +3 functions; the
conformance spec itself never needs a count bump.

**Phase 4 / Slice 2 (2026-07-16):** added three functions for guardian portal
auth (`auth_resolve_guardian_session`, `auth_lookup_guardians_for_login`,
`auth_resolve_invitation_by_token_hash`'s guardian equivalent) — count moves
7 → 10, crossing the "+3" cadence trigger set at the Slice 12 audit (due at
8). The shape review itself has not been done yet — flagged as due, not
completed, in this PR. `auth_lookup_guardians_for_login` is also a shape
outlier worth specific attention at that review: it's the only function in
this table that returns multiple rows rather than zero-or-one, a direct
consequence of Decision C's per-school (not global) email uniqueness for
guardians. Documented as an interim strategy — see its own row above and the
migration's header comment — pending a real fix (e.g. a school selector in
the portal login flow) at a later slice.

**Phase 0 gap closed (2026-07-24):** added two functions closing out the
forgot/reset-password flow that Phase 0 specced but never built
(`auth_lookup_user_for_password_reset`, `auth_resolve_password_reset_token`)
— count moves 10 → 12, further past the "+3" cadence trigger that was
already flagged as due at 8 during Phase 4/Slice 2 and still hasn't
happened. Still not done by this PR either — flagged again, not resolved.
Both new functions follow the narrow-single-caller discipline the Slice 12
audit settled on: neither reuses `auth_lookup_user_for_login`'s wider
`password_hash`-bearing return shape, even though the lookup key (email) is
the same.

**Platform super-admin (2026-08-02):** added three functions for the new
internal, read-only, cross-tenant admin surface — count moves 12 → 15,
further past the "+3" cadence trigger set at the Slice 12 audit (due at 8,
already flagged again at 12, still not done by this PR either). This PR's
three functions follow the narrow-single-caller discipline directly:
`platform_admin_resolve_session` deliberately omits `school_id` (the one
function in this table whose subject is cross-tenant by definition, not
tenant-scoped), and both list functions omit every field outside the
approved "names, signup dates, status, basic counts" scope (no financial
data, no student PII beyond basic metadata, no phone/BVN).

**Platform super-admin school provisioning (2026-08-07):** added one
function, `platform_admin_check_owner_email_available` — count moves 15 →
16, further past the "+3" cadence trigger set at the Slice 12 audit (due at
8, already flagged again at 12 and 15, still not done). This is the
surface's first WRITE (`POST /platform-admin/schools`: super-admin supplies
a school name + owner email, the API creates the `School` row and an
`owner`-role `Invitation`, and the invitee gets a real email reusing the
existing Invitation/accept/session machinery unchanged — no changes to
`invitations.service.ts` were needed). The write itself needed no new
SECURITY DEFINER function: `School`/`Invitation` creation reuses
`AuthService.signupOwner`'s exact pattern (`basePrisma.$transaction` + raw
`SET LOCAL app.current_school_id`), the same division of concerns as every
other function in this table — SECURITY DEFINER is only for the pre-tenant
availability read, which both `users` and `invitations` being under FORCE
RLS makes otherwise unanswerable before a tenant (and therefore a GUC)
exists. `platform_admin_list_schools`'s return shape also changed in this
PR (see its own row above) — a DROP + CREATE, not a count-changing addition,
since it's the same function name.

**Early-access marker (2026-08-09):** `platform_admin_list_schools()`'s return
shape changed a third time (adding `early_access_granted_at`) — a DROP +
CREATE of the same function name, **not** a count-changing addition. Count
stays at 16. Verified against a live database after applying the migration:
owner `school_kit`, `prosecdef = true`, `search_path=public, pg_temp` pinned,
EXECUTE granted to `app_user` only with PUBLIC absent, and
`SELECT count(*) FROM pg_proc WHERE prosecdef` returning exactly 16.

**Per-school AI toggle (2026-08-14):** `platform_admin_list_schools()`'s return
shape changed a fourth time (adding `ai_enabled`) — a DROP + CREATE of the same
function name, **not** a count-changing addition. Count stays at 16. The new
`PATCH /platform-admin/schools/:schoolId/ai` endpoint needed no SECURITY
DEFINER function of its own, for the same reason `PATCH …/early-access`
didn't: `schools` is the one table with no RLS policy (it IS the tenant table
every other policy keys off), so a single-column `basePrisma.school.update`
plus an audit row is both sufficient and consistent with what this module
already does. SECURITY DEFINER is only ever needed here for pre-tenant *reads*
against FORCE-RLS tables.

**Paystack assisted setup (2026-08-15):** added one function,
`platform_admin_list_paystack_setup_requests` — count moves 16 → 17. The
initiative deliberately adds only one: the banking-detail reveal runs as an
ordinary `basePrisma.$transaction` + `SET LOCAL app.current_school_id` read
once the list has resolved a `school_id`, the same division of concerns
`createSchool` established (SECURITY DEFINER only for the *pre-tenant* read).
That keeps every account-number read inside RLS and individually audited,
rather than widening a SECURITY DEFINER return shape to carry banking data.
Verified against a live database after applying the migration: owner
`school_kit`, `prosecdef = true`, `search_path=public, pg_temp` pinned,
EXECUTE granted to `app_user` only with PUBLIC absent, `SELECT count(*) FROM
pg_proc WHERE prosecdef` returning exactly 17, and the RLS boundary itself
exercised as `app_user` (no-GUC read returns 0 rows; a school-A GUC sees only
school A; a cross-tenant INSERT is rejected by the policy's WITH CHECK; the
SD function returns both tenants' rows in the same session where the direct
select returns none).

**The "+3" cadence review is now DONE (2026-08-15)** — first carried out
since it was set at the Slice 12 audit, having been flagged as due at 8 and
missed at 12, 15 and 16. Outcome: **no consolidation**, same verdict and same
reasoning as the original audit. The 17 functions fall into four
non-overlapping families — pre-tenant auth lookups (7), pre-tenant guardian
auth (3), platform-admin cross-tenant reads (4, now including this one), and
domain primitives that aren't RLS escapes at all (`create_audit_log_partition`,
`encrypt_bvn`, `decrypt_bvn`). Every function still has exactly one caller and
a return shape narrowed to that caller's need; merging any two would either
widen a return row or require a "which entity type" branch argument, both of
which weaken the discipline the table exists to enforce. The real gate remains
`security-definer-inventory.spec.ts`, which holds at any count. Next review
due at 20.

**Student portal auth (2026-08-15):** added three functions —
`auth_resolve_student_session`, `auth_lookup_student_for_login`,
`auth_resolve_student_invitation` — count moves **17 → 20**. The slice
plan-first anticipated two; the third follows from D26 replacing
guardian-typed passwords with a single-use invitation token, since a child
opening that link has no session and no school context. Verified against a
live database after applying: all three `prosecdef`, owned by `school_kit`,
`search_path=public, pg_temp` pinned, EXECUTE granted to `app_user` with
PUBLIC absent, `SELECT count(*) FROM pg_proc WHERE prosecdef` returning
exactly 20, and the RLS boundary exercised as `app_user` — no-GUC reads
return 0 rows, a school-A GUC sees only school A (0 school-B rows leaked)
and vice versa, cross-tenant INSERTs are rejected by `WITH CHECK` on both
new tables **with a valid GUC set**, and a control insert under the correct
GUC succeeds so those rejections are not passing for the wrong reason.

**The "+3" cadence review was due at 20 and HAS NOW BEEN DONE** — see the
review immediately below, carried out 2026-08-16 after five consecutive
flags went unactioned (8, 12, 15, 16, 19).

**THE "+3" CADENCE REVIEW IS DONE (2026-08-16), at count 20.** Performed
against `pg_proc` — actual signatures and return shapes read from a live
database, not from this table's description of them. Sixth time it was due;
first time since the count-16/17 review that it was actually carried out.

**Verdict: NO consolidation. The current shape is correct — and for the
session family, consolidation would be an active security regression.**

The 20 functions fall into five non-overlapping families:

| Family | Count | Members |
|---|---|---|
| Session resolvers | 4 | `auth_resolve_session`, `auth_resolve_guardian_session`, `auth_resolve_student_session`, `platform_admin_resolve_session` |
| Invitation / token resolvers | 4 | staff, guardian and student invitations, plus `auth_resolve_password_reset_token` |
| Pre-tenant credential lookups | 4 | `auth_lookup_user_for_login`, `..._for_password_reset`, `auth_lookup_guardians_for_login`, `auth_lookup_student_for_login` |
| Platform-admin cross-tenant reads | 5 | 3 list functions, `..._check_owner_email_available`, `auth_check_signup_uniqueness` |
| Domain primitives (not RLS escapes) | 3 | `create_audit_log_partition`, `encrypt_bvn`, `decrypt_bvn` |

**The session family is the strongest consolidation candidate on paper, and
it must never be consolidated.** All four take an identical signature
(`p_token_hash text`) and return overlapping shapes, which is exactly what a
"merge these" instinct keys on. The reason to refuse is stronger than the
"it would widen a return row" argument the previous two audits used:

The three principal session tables are **separate tables** — `sessions`,
`guardian_sessions`, `student_sessions`. Today, a student's bearer token
presented to the staff `AuthGuard` resolves to **nothing**, because
`auth_resolve_session` reads only `sessions`. Cross-principal token confusion
is *structurally impossible*. A consolidated resolver would `UNION` across
all three, making every token resolvable at every guard, and the boundary
would survive only if each caller remembered to check a returned
`principal_type`. That converts an impossibility into a convention — the same
trade this codebase already refused for `basePrisma` and for the Anthropic
client, and the wrong direction for the one boundary separating a child's
session from a staff member's.

The other families are unmergeable on plainer grounds: `auth_lookup_student_
for_login` takes a different key entirely (`slug` + `admission_number`, not
email); `auth_lookup_guardians_for_login` is multi-row; the student
invitation resolver is deliberately far narrower than the staff and guardian
ones (no name, no email — it backs a PUBLIC endpoint taking an
attacker-supplied token) and filters liveness in its own `WHERE`; and
`auth_lookup_user_for_password_reset` exists precisely so the reset path
never sees `password_hash`.

**The review's real finding is not about merging — it is that the four
session resolvers DISAGREE ABOUT REVOCATION, and two of them cannot revoke
at all:**

| Resolver | Revocation signal returned |
|---|---|
| `auth_resolve_student_session` | `student_status` **and** `portal_enabled` — school-side and guardian-side, both re-read per request |
| `auth_resolve_session` (staff) | `user_is_active` |
| `auth_resolve_guardian_session` | **none** — `Guardian` has no `is_active`; clearing `password_hash` is the only lever, and it does not invalidate a live session |
| `platform_admin_resolve_session` | **none** — no platform-admin deactivation flow exists |

Slice 3 made this sharper rather than causing it: students now have the
strongest revocation story in the system, and the two principals with the
*most* access — a parent, and a cross-tenant platform admin — have the
weakest. A guardian whose account should be cut off keeps a working session
for up to 30 days.

**Recommended, not done here** (out of slice 3's scope, and both are small):
add an `is_active`-equivalent to `Guardian` and return it from
`auth_resolve_guardian_session`; return `user_is_active` from
`platform_admin_resolve_session`. Logged in `docs/deferred.md`.

Also noted and deliberately NOT acted on: the invitation resolvers are
inconsistently named (`auth_resolve_invitation_by_token_hash` and
`auth_resolve_guardian_invitation_by_token_hash` carry a `_by_token_hash`
suffix; `auth_resolve_student_invitation` does not). Renaming would touch
every call site and the conformance spec's pinned name list, for zero
behavioural gain. Recorded so the inconsistency reads as known rather than
accidental.

**Staff mobile visibility (2026-08-25):** `platform_admin_list_schools()`'s
return shape changed a fifth time (adding `staff_mobile_enabled`) — a DROP +
CREATE of the same function name, **not** a count-changing addition. Count
stays at 20 and the next review stays due at 23. Verified against a live
database after applying the migration: owner `school_kit`, `prosecdef = true`,
`search_path=public, pg_temp` pinned, EXECUTE granted to `app_user` with PUBLIC
absent (`proacl` shows only `school_kit=X` and `app_user=X`), the new column
present in `pg_get_function_result`, and `SELECT count(*) FROM pg_proc WHERE
prosecdef` returning exactly 20.

**Next review due at 23.**

**Current count: 20.**

### ESM module resolution

- Workspace packages (`packages/*`) compile to `dist/`. Their `package.json` `main`/`types`/`exports` fields point at compiled output, never at `src/`.
- TypeScript `module: Node16`, `moduleResolution: Node16` in each workspace package's `tsconfig.json`.
- Relative imports inside `.ts` source files use `.js` extensions — TypeScript preserves them; Node ESM requires them.
- Generated code (Prisma client) lives outside `src/` so compiled `dist/` can reach it with the same relative path.
- - Tests pass under Vitest+SWC's permissive resolution; runtime AND CI use 
  Node ESM's strict resolution. If a package builds clean but runtime fails 
  with `ERR_MODULE_NOT_FOUND`, either the package is misconfigured, or 
  `dist/` doesn't exist yet — locally that's a missing `pnpm build`, in CI 
  it's a missing "Build workspace packages" step before the failing step. 
  Tests passing isn't proof of correct module resolution — Vitest+SWC 
  tolerates missing `dist/` by walking workspace symlinks to `.ts` source. 
  Any tooling that uses Node ESM directly (`tsx`, plain `node`, Next.js' 
  server runtime, `prisma db seed`) will surface the gap.
- Config files for CSS/build tooling (`tailwind.config.ts`, `postcss.config.mjs`, etc.) must also be ESM in an ESM project. Use top-of-file `import` rather than `require()` even when the tool's docs show `require()` examples — those examples assume CommonJS. Tests don't catch this because the CSS pipeline only runs on real browser routes; the symptom is `ReferenceError: require is not defined` at the first request that triggers a Tailwind compile.
- CJS-only npm packages (no `"type": "module"`, no `"exports"` map, single `module.exports = X`) work fine via `import x from "pkg"` thanks to Node's CJS interop — `x` resolves to `module.exports`. If a package instead does `module.exports.foo = ...` (named exports) the default import gives you the *namespace object*, and you either destructure (`import { foo } from "pkg"`) or use `import * as pkg`. Inspect `node_modules/<pkg>/index.js` once when adding a new dependency; the project standardises on the simplest form that works.

### NestJS module structure

Every module lives in `apps/api/src/modules/<module-name>/`:

```
attendance/
  attendance.module.ts
  attendance.controller.ts
  attendance.service.ts
  attendance.repository.ts        # only if Prisma calls get complex
  dto/
    mark-attendance.dto.ts
    get-attendance.dto.ts
  guards/
    can-mark-attendance.guard.ts
  attendance.service.spec.ts
```

DTOs are Zod schemas in `packages/types`, validated by a global `ZodValidationPipe`.

### Next.js routes

App Router with route groups for role-based layouts:

```
src/app/
  (marketing)/        Public marketing pages
  (auth)/             Login, signup, password reset
  (admin)/            Admin + owner UI (shared layout)
    dashboard/
    settings/
  (teacher)/          Teacher UI
    classes/
    gradebook/
  api/                Edge functions only if absolutely needed
```

Server components by default. Add `'use client'` only when needed (forms, interactive state, hooks).

### Server actions vs API

- NestJS REST API for everything with business logic, transactions, or cross-cutting concerns (auth, audit, AI calls).
- Next.js server actions only for trivial form submits that proxy to the API.
- Mobile and web both hit the same NestJS endpoints. No duplicated logic.

### Error handling

- All API errors extend `BaseError` from `packages/types/src/errors.ts`
- Response shape: `{ error: { code: string, message: string, details?: unknown } }`
- Frontend uses `@tanstack/react-query` with a global error handler that shows a toast and routes 401s to login.

### Tests

- Unit tests for services with business logic (grading, fee calc, attendance %).
- Integration tests for controllers with mocked Prisma.
- E2E (Playwright) for critical user flows: signup → onboard → first student → first payment.
- Run: `pnpm test` (all), `pnpm test:e2e`, `pnpm test:watch`.

**Resolved 2026-07-25 — CI's `e2e (Playwright)` job no longer needs the
`--admin` merge workaround.** From 2026-06-27 through 2026-07-25 it timed
out on every push, and every PR merged via `gh pr merge --admin` as routine
practice. Root cause was NOT the logout→re-login flow (an earlier hypothesis
here, since disproven by real local reproduction) — it was
`acceptInvitation()` bypassing the `sk_session` cookie-setting proxy route
entirely, so every invitation-accept hard-navigation got silently bounced
back to `/login` by `middleware.ts`, and the e2e spec's `waitForURL` (no
per-call timeout) burned the full 180s test budget every time. Full writeup
and fix verification in `docs/deferred.md`. If `e2e (Playwright)` starts
failing again, it is NOT automatically this same issue — investigate fresh
rather than assuming a recurrence.

### Next.js route groups vs URL segments

- Route groups: folders wrapped in parens like `(auth)`, `(admin)`. 
  Organise files without affecting the URL. The folder name is stripped.
  - `app/(admin)/dashboard/page.tsx` → URL `/dashboard`
  - `app/(auth)/login/page.tsx` → URL `/login`
- Real URL segments: plain folder names without parens.
  - `app/onboarding/3/page.tsx` → URL `/onboarding/3`
- When `docs/modules/*.md` specifies a URL path, the folder structure 
  must match that path literally. If the spec says `/onboarding/3`, 
  the folder is `onboarding/3` — NOT `(onboarding)/3`.
- Tests don't catch this. Only the browser does. Verify visually 
  when introducing any new route.

  ### Dev overlay vs production error boundaries

Next.js dev mode shows a red error overlay BEFORE `global-error.tsx` renders.
This is a dev tool, not a bug. To verify the production error boundary,
either dismiss the overlay (press Esc), or run `pnpm build && pnpm start`
to test against the production server. In prod, errors go straight to
`global-error.tsx` and `Sentry.captureException` fires from inside that
boundary's useEffect.

## Design system

**Visual/UX overhaul initiative (started with the admin dashboard rebuild,
2026-07-26).** `apps/web` shipped on stock, unmodified shadcn/ui defaults
(pure white background, near-black slate primary, no dark mode) up to this
point — the tokens below are the first real brand identity applied, starting
with `apps/web/src/app/(admin)/dashboard`. Other pages restyle in later
passes; until then they keep the shadcn defaults.

**Color tokens** (source hex — the shadcn `hsl(var(--x))` HSL conversions
live in `apps/web/src/app/globals.css`, which is the values source of truth;
this table documents the decision, not a second copy of the numbers):

| Name | Hex | Role |
|---|---|---|
| Paper | `#F7F5EF` | `--background` / `--card` — warm cream, not stark white |
| Ink | `#13262E` | `--foreground` — body text on Paper |
| Deep Emerald | `#0E5C43` | `--primary` (light mode) — progress bars, links, active nav |
| Bright Emerald | `#3FB68B` | `--primary` (dark mode only — better contrast on a dark surface than Deep Emerald) |
| Gold Spark | `#E0A52E` | `--secondary` — used sparingly (one metric's progress bar, a summary row), not a second primary |

Typefaces: **Fraunces** (serif — large KPI numerals, page headings, the
dashboard's greeting line) paired with **Hanken Grotesk** (sans — body text,
labels, nav). Both loaded via `next/font/google` in `apps/web/src/app/
layout.tsx` (self-hosted by Next at build time, no runtime call to Google's
CDN), exposed as `--font-hanken-grotesk`/`--font-fraunces` and re-mapped to
`--font-sans`/`--font-serif` in `globals.css`. Dark mode (`next-themes`,
`attribute="class"`, matching the existing `darkMode: ["class"]` Tailwind
config) is genuinely new — it did not exist before this initiative.

**"Groups" API shape — the single-school-now/multi-campus-later pattern.**
`Branch` has existed in the schema since Phase 0 (full CRUD, RLS, permissions)
but no operational table (`Student`, `Enrollment`, `Invoice`, `AttendanceRecord`,
`TeacherProfile`) carries a `branchId` — multi-campus is a real future feature,
not built yet. Rather than adding `branchId` speculatively, any dashboard/
report endpoint that would eventually break down by campus returns a generic
`{ groupId, label, ... }[]` shape instead of a flat object — see
`DashboardCollectionGroupDto` in `packages/types/src/dashboard/admin-dashboard.dto.ts`.
Today `groupId` is a `ClassLevel.id` (the closest real breakdown dimension for
a single-campus school); when multi-campus ships, the same query re-keys on
`Branch.id` with zero frontend contract change. Apply this pattern to any
future per-school-structure aggregation before reaching for a flat shape.

**Permission naming for work that isn't a numbered Phase.** Not everything is
Phase-1-through-5 — this initiative isn't Phase 5 (that's reserved for the AI
layer, see `docs/deferred.md`) and Phase 4 is already closed. Permissions for
cross-cutting initiatives like this one get their own descriptively-named
constant (e.g. `ADMIN_DASHBOARD_PERMISSIONS`) spliced into `ALL_PERMISSIONS`,
rather than being force-fit into an adjacent phase's array.

**Real logo upload (2026-07-26), replacing the raw URL text field the school
logo had shipped with since Phase 0** — see `docs/deferred.md` for the full
history of that gap (the spec named logo upload as the ONE upload feature
Phase 0 had to ship; the shipped code silently substituted a URL text field
instead, and that substitution was never tracked anywhere until this fix).
Two conventions this established, worth reusing for any future "small,
frequently-displayed branding/media asset" case:
- **Serving pattern**: `GET /schools/me/logo-url` returns `{ url }` in
  ordinary JSON (Bearer-authenticated, works exactly like any other
  `apiFetch` call), and the frontend sets that URL directly as an `<img
  src>`. This deliberately avoids two more complex alternatives: (a) making
  the object *actually* public in R2 (a real bucket-policy/CORS change we
  didn't want to make to the storage layer we'd just finished hardening),
  and (b) a `fetch()` + blob-URL dance (unnecessary — a plain `<img src>` /
  `window.open()` browser-native resource load is NOT subject to CORS the
  way `fetch()`/XHR are, so a presigned URL works directly with zero CORS
  configuration; `getExpenseReceiptUrl` already relied on this same fact via
  `window.open()`, this just extends it to `<img>`). TTL is long (1 hour)
  relative to receipts' 15 minutes — a logo is displayed for the life of a
  session, not fetched once for a single click-through.
- **Extension-bearing storage key**: unlike `expense-receipt` (extensionless
  — its Content-Type travels as upload-time object metadata only), a key
  meant to work correctly in **dev** (the filesystem driver) needs a real
  file extension, because `FilesystemStorageDriver.put()` discards the
  `contentType` it's given entirely (no metadata sidecar) and
  `DevStorageController` can only recover the right `Content-Type` from the
  path extension. `{ kind: "school-logo"; ext: "png" | "jpg" | "webp" }` is
  the template — see `storage.types.ts`'s header comment on that key for the
  full reasoning, including why a re-upload with a *different* extension
  needs an explicit `storage.delete()` of the old object first (an
  extension-bearing key doesn't self-overwrite the way expense-receipt's
  extensionless one does).

## Adding a new module

1. Read or write `docs/modules/<module>.md` (purpose, entities, endpoints, screens, tests).
2. Add Prisma models to `packages/db/prisma/schema.prisma`.
3. Run `pnpm db:migrate -- --name add_<module>`.
4. Add RLS policies in `packages/db/prisma/policies/<module>.sql` and apply them.
5. Create the NestJS module skeleton in `apps/api/src/modules/<module>/`.
6. Add DTOs in `packages/types/src/<module>/` with Zod schemas.
7. Implement the service test-first.
8. Implement the controller with auth + RBAC guards.
9. Add API client functions in `packages/types/src/api/<module>.ts`.
10. Build web UI in `apps/web/src/app/(role)/<module>/`.
11. Build mobile UI in `apps/mobile/src/screens/<module>/` if user-facing for parents/students.
12. Add at least one E2E test for the happy path.
13. Update `docs/modules/<module>.md` with anything that changed.

## Dev commands

```bash
# First-time setup
pnpm install
cp .env.example .env
pnpm db:up                    # postgres + redis in docker
pnpm db:migrate
pnpm db:seed

# Daily dev
pnpm dev                      # all apps via Turborepo
pnpm dev:api                  # api only
pnpm dev:web                  # web only
pnpm dev:mobile               # expo

# Database
pnpm db:migrate -- --name <name>
pnpm db:reset                 # nuke and re-seed
pnpm db:studio                # Prisma Studio

# Quality
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e

# AI evals
pnpm ai:eval                  # run prompt eval suite (required before any prompt PR merges)
```

## Git conventions

- Branches: `<phase>/<module>` e.g. `phase-2/attendance`, or `fix/<short>`.
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- PR title: scope + summary, e.g. `feat(attendance): daily marking with SMS alert`.
- One module = one PR. Squash on merge.

## Environment variables

Documented in `.env.example`. Critical:

```
DATABASE_URL
REDIS_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
ANTHROPIC_API_KEY
PAYSTACK_SECRET_KEY
PAYSTACK_PUBLIC_KEY
TERMII_API_KEY
TERMII_SENDER_ID
TERMII_BASE_URL
RESEND_API_KEY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
SENTRY_DSN_API
NEXT_PUBLIC_SENTRY_DSN
SENTRY_ENVIRONMENT
NEXT_PUBLIC_POSTHOG_KEY
NEXT_PUBLIC_POSTHOG_HOST
WEB_BASE_URL
PORTAL_BASE_URL
```

Never commit. Never log. Test keys and live keys are different env files.

`WEB_BASE_URL` — the API can hold a `WEB_BASE_URL` env var when constructing
user-facing URLs (invitation accept links, password reset links, etc.). The
API never follows these URLs; it only constructs them for delivery. Production
must set this explicitly; dev defaults to `http://localhost:3001`.

`PORTAL_BASE_URL` — same purpose as `WEB_BASE_URL`, for guardian portal
invitation accept links (`POST /guardians/:id/invite`). Production must set
this explicitly to `https://portal.schoolkit.ng`; dev defaults to
`http://localhost:3002` (apps/portal's dev port, D9 in phase-4.md §7).

`TERMII_BASE_URL` — unlike Paystack's fixed `api.paystack.co`, Termii's API
base URL is **per-account** (dashboard-assigned), not a global constant.
`.env.example` defaults to `https://api.ng.termii.com` (the commonly-
documented Nigeria-region value), but this must be confirmed against the
actual provisioned account before any production SMS send — see
`docs/modules/phase-4.md` §8 D6 for the research trail. `TermiiService`
(`apps/api/src/common/termii/termii.service.ts`) reads it via `ConfigService`
with that same default, so a missing env var doesn't break dev/test, only a
wrong one silently misroutes production sends.

**There is no isolated staging environment (confirmed 2026-07-16).** `deploy-
staging.yml` and the `STAGING_*` GitHub secret names (`STAGING_DATABASE_URL`,
`STAGING_DIRECT_URL`, etc.) are a naming convention, not a separate
infrastructure tier — this project has exactly one Neon project/branch
(`school-kit-prod`), one `school-kit-api` Fly app, and one `school-kit-
render-worker` Fly app (see `docs/runbooks/neon-prod-setup.md` — the only
provisioning runbook, note its own title). Every "staging" deploy is a
production deploy against the same database real schools' data lives in.
`SENTRY_ENVIRONMENT=staging` is the only thing that distinguishes a
"staging" event from a "prod" one in Sentry — a label, not a boundary.
Practical consequence: `deploy-staging.yml`'s auto-rollback-on-smoke-failure
only rolls back the Fly API release, not a migration that already ran — so
there is no soak period protecting real data from a bad migration. Treat
every migration's RLS/SECURITY DEFINER correctness accordingly. (This note
is docs-only — the `STAGING_*` secret names and the `deploy-staging.yml`
filename are intentionally NOT being renamed/restructured as part of this
fix; that's a separate, larger change if ever done.)

**Recreating a Vercel project does NOT carry over its environment
variables (confirmed 2026-07-17).** `school-kit-portal` was deleted and
recreated during Slice 1 CP2 troubleshooting (to fix a stuck Root
Directory/Build Command setting) — the new project silently started with
zero environment variables. `NEXT_PUBLIC_API_URL` was missing for 5+ days
before it surfaced as a real bug: the guardian-invite manual test's
accept-invite page 500'd with `ECONNREFUSED 127.0.0.1:4000`, because the
portal's Next.js proxy route fell back to its local-dev default with no
production API URL configured. Nothing caught this earlier because the
portal's own health check (`GET /api/health`) doesn't call the API at all —
only routes that actually proxy to `apps/api` would ever have exposed the
gap. **Always run `vercel env ls` on a project immediately after recreating
it**, and don't assume "the build succeeded" or "the health check passed"
means env vars survived.

The `PORTAL_BASE_URL` Fly secret being missed entirely during the Slice 2
migration pass (added to `.env.example`/CI, never actually set via `flyctl
secrets set` on the running `school-kit-api` app, so `POST /guardians/:id/
invite` built accept URLs pointing at `localhost:3002` in production) is
the same failure category, on the other platform: config added to the repo
but never verified against the actual deployed environment. Both bugs
shipped invisibly past CI, both were only caught by an end-to-end manual
test, not by any automated check — worth remembering when a slice touches
either platform's config surface.

## When asking Claude Code for help

Open with the relevant spec. Example:

> Read `docs/modules/attendance.md` and `CLAUDE.md`, then implement the daily attendance endpoint in `apps/api/src/modules/attendance/`. Write the service spec first, then the implementation. Don't touch the UI yet.

Avoid pasting the whole codebase — Claude Code reads what it needs. Keep each prompt scoped to a single concern.

## Things this file does not cover yet

These get added as decisions are made:

- Subscription billing system (per-student vs flat)
- Offline sync strategy for mobile
- WhatsApp Business API approval state
- Curriculum content licensing
- Specific PII fields covered by NDPR redaction
