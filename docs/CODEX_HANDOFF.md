# Codex handoff

**Purpose:** School Kit is normally built with Claude Code, which keeps a
persistent cross-session memory on the maintainer's machine
(`~/.claude/projects/.../memory/`). This doc is a one-time export of that
memory into the repo, written 2026-07-29, so a different coding agent
(Codex) can pick the project up temporarily without repeating already-solved
problems. **This file will go stale** — it's a snapshot, not a live feed.
When the maintainer returns to Claude Code, they should point it at this
file's "Latest state" section (updated by whoever/whatever works from this
file) plus `git log` so its own memory catches back up.

Read `AGENTS.md` and `CLAUDE.md` first if you haven't. This file supplements
those; it doesn't replace them.

---

## Environment quirks (Windows dev machine)

- **Node is 24.15.0 on this machine, not the 22.x LTS `CLAUDE.md` pins.**
  Maintainer has confirmed proceeding on 24 is fine for now. If a package
  install throws an engine warning, that's why — not a new problem.
- **Corepack can't activate pnpm** — Node lives in `C:\Program Files\nodejs\`
  and Corepack needs admin rights to write there. Use
  `npm install -g pnpm@9.15.0` instead (npm's global prefix is
  `C:\Users\acer\AppData\Roaming\npm`, user-writable).
- **PowerShell blocks `npm.ps1`/`pnpm.ps1`** (`Get-ExecutionPolicy` is
  restricted) — running npm/pnpm from PowerShell fails with "running scripts
  is disabled on this system." A POSIX shell (Git Bash, etc.) invokes the
  `.cmd` shim instead and works fine. PowerShell itself is fine for anything
  that isn't shelling out to a `.ps1`.
- **Web dev runs on port 3001, not 3000, permanently.** A long-running
  unrelated `node` process squats on :3000 on this machine. `apps/web`'s dev
  script is `next dev --port 3001`, and `.env.example`'s `BETTER_AUTH_URL`
  matches. Don't "fix" this back to :3000. API stays on :4000, Expo Metro on
  :8081, Prisma Studio on :5555.
- **Docker Desktop is installed and required for local Postgres+Redis.**
  `pnpm db:up` brings up `school-kit-postgres` (pgvector/pgvector:pg16) +
  `school-kit-redis`; `pnpm db:down` stops them. Init scripts in
  `infra/postgres/init/` only run on a fresh volume (they create extensions
  + the `app_user` role) — `pnpm db:reset` drops the DB only; `docker compose
  down -v` + `pnpm db:up` drops the volume too.
- **`prisma migrate dev` needs a real TTY** and refuses to run in a
  non-interactive shell (exits with "non-interactive environment, which is
  not supported" — looks like a Prisma bug at first, isn't). If you're
  running non-interactively, use `migrate diff` + `migrate deploy` instead:
  ```bash
  PRISMA_HIDE_UPDATE_MESSAGE=true \
    pnpm --filter @school-kit/db exec dotenv -e ../../.env -- \
    prisma migrate diff \
      --from-migrations prisma/migrations \
      --to-schema-datamodel prisma/schema.prisma \
      --script \
      > prisma/migrations/<timestamp>_<name>/migration.sql

  pnpm --filter @school-kit/db migrate:deploy
  ```
  Use `--from-empty` instead of `--from-migrations` only for a brand-new
  migration history (not applicable here — history already exists). Always
  set `PRISMA_HIDE_UPDATE_MESSAGE=true` when piping to a file, or Prisma's
  update-notice banner gets appended to the SQL and breaks it with a syntax
  error near `"┌"`. If you have a real interactive terminal, `pnpm db:migrate
  -- --name <name>` (which calls `migrate dev`) is the right/normal command.

## Hard-won debugging lessons (don't re-discover these)

- **Never set `incremental: true` in `apps/api/tsconfig.json`.**
  `nest-cli.json` has `deleteOutDir: true`, which wipes `apps/api/dist/`
  before each build. With incremental builds on, tsc trusts its
  `tsbuildinfo`, sees no input changes, and emits nothing — even though the
  output was just deleted — so `pnpm dev:api` crashes with
  `Cannot find module '.../dist/main'` and tsc exits 0 with no error. If you
  ever see that crash, check for `incremental: true` or a stray
  `tsconfig.build.tsbuildinfo` first.
- **Postgres RLS is silently bypassed for `SUPERUSER`/`BYPASSRLS` roles —
  `FORCE ROW LEVEL SECURITY` does NOT protect against this**, it only forces
  RLS for the table *owner*, not for superusers. There is no error when this
  happens; queries just quietly return all rows across tenants. This is the
  single highest-severity bug class in this codebase. The project uses two
  DB roles specifically to guard against it: `school_kit` (SUPERUSER, used
  only for migrations via `DIRECT_URL`) and `app_user` (no elevated
  privileges, used by the runtime Prisma client via `DATABASE_URL`, created
  in `infra/postgres/init/02-app-role.sql`). Never grant `SUPERUSER` or
  `BYPASSRLS` to `app_user`. `apps/api/src/__tests__/rls.spec.ts` exists
  specifically to catch a regression here (7 assertions — cross-tenant
  isolation, WITH CHECK on insert, raw-SQL GUC filtering, unset-GUC returns
  zero rows, `withTenant` rejects non-UUID school IDs).
- **Under FORCE RLS, Postgres strips the constraint name from unique-
  violation errors** (to avoid leaking "an account with this email exists in
  another tenant" through error metadata). Prisma surfaces this as
  `meta.target: null` + "Unique constraint failed on the (not available)" —
  no way to tell which field collided from the error alone. Fix pattern used
  throughout: a `SECURITY DEFINER` Postgres function that returns booleans
  only (e.g. `auth_check_signup_uniqueness`, see the SECURITY DEFINER
  inventory table in `CLAUDE.md`), granted EXECUTE to `app_user`, called as
  a pre-check before the write transaction opens. Tables WITHOUT RLS (e.g.
  `schools`) don't have this problem — normal Prisma P2002 handling works.
- **Vitest's default esbuild transform drops NestJS decorator metadata.**
  Symptom: `Cannot read properties of undefined (reading '<method>')` on
  injected services/controllers inside integration specs that spin up a real
  Nest test module (`Test.createTestingModule(...).compile()`) — plain
  `new Service()` unit specs are unaffected. Fix: add `unplugin-swc` to
  `vitest.config.ts` with `legacyDecorator: true, decoratorMetadata: true`
  (see `apps/api/vitest.config.ts` for the exact config block — the keys are
  easy to typo).

## Project landmarks (Phase 0 scaffold, still accurate as of 2026-07-29)

- Workspace root `package.json` name is `school-kit`; packages are
  `@school-kit/*` (config, db, types, ui, ai, api, web, mobile).
- Prisma schema: `packages/db/prisma/schema.prisma`. Generated client output
  goes to `packages/db/src/generated/client` (gitignored) — import via
  `@school-kit/db`, which re-exports `{ PrismaClient, Prisma }`.
- Tenant client: `packages/db/src/tenant-client.ts` exports
  `withTenant(schoolId, fn)` — opens a `$transaction`, sets
  `app.current_school_id` via `set_config(..., is_local=true)`, then runs the
  callback. Every authenticated handler must route through this; never call
  `basePrisma.<table>.<op>()` directly on a tenanted table.
- RLS policies: `packages/db/prisma/policies/phase-0.sql` is the canonical
  source, also copied verbatim into migration
  `20260514120001_add_rls_policies/migration.sql` — if you change one, change
  both (or refactor to single-source). Tables under RLS+FORCE: `branches`,
  `users`, `user_roles`, `sessions`, `invitations`, `audit_logs`. NOT under
  RLS (deliberately): `schools` (filtered by ownership at the API layer),
  `roles` (system roles are shared; custom roles filtered at the API layer).
  `audit_logs` allows `school_id IS NULL` for pre-tenant system actions
  (e.g. signup) — don't blindly copy that exception onto a new table unless
  it genuinely has legitimate null-tenant rows.
- Project was renamed from working title "Naija Class" to "School Kit" on
  2026-05-13. All source/docs/configs use `school-kit` now. Two paths still
  bear the old name on disk, deliberately not renamed yet (requires closing
  the editor session): the repo folder itself
  (`c:\Users\acer\Desktop\Naija-class\`) and Claude Code's memory directory
  (derived from the folder name). Don't rename either mid-session.

## Latest state as of this handoff (updated 2026-08-22)

- **Payment-link plan-first is merged in docs-only PR #203; implementation
  CP1 and CP2 are complete on `feat/payment-links`.** A real Paystack
  test-mode follow-up proved one `percentage: 100` split reusable at 123,400
  and 987,600 kobo, with integration share zero and the school receiving gross
  less Paystack fee both times. The final plan in
  `docs/modules/shareable-payment-links.md` covers the school split column,
  assisted-setup creation, existing-school backfill, durable link lifecycle,
  synthetic customer email, metadata-correlated `paymentrequest.*` webhook,
  archive-on-every-balance-change, no-recipient WhatsApp share, visible
  connect state, tests and rollout gates. CP1 now implements the school split
  column/migration, assisted-setup split creation, drift rules and audited
  operator backfill. CP2 adds the FORCE-RLS durable link model, database
  reservation/uniqueness, Paystack create/fetch/archive wrappers, synthetic
  customer and correlation metadata, and idempotent GET/POST lifecycle. Real
  RLS control/rejection, concurrent uniqueness and Paystack test-mode gates
  passed; see `docs/journal/2026-08-22.md`. CP3 (webhook and finance
  invalidation) is next.
- **RBAC conformance PR #204 is merged on `main`.** Its real-DI I1/I2 gate
  holds all 20 deliberate disagreements as six reasoned exception groups and
  enforces zero undocumented, stale, or duplicate exceptions. The ~89-site
  cleanup remains an incremental follow-on; production auth and `isActive`
  were not changed.

- **Most recent merged PR:** #128 (`docs: close the two Phase 4 restyle bugs
  in deferred.md`), on top of #127 (mobile nav fix) and #126 (RBAC
  `grading-scheme.read` grant) — both of which closed out bugs found during
  the Phase 4 design-system restyle's live-verification pass. Phase 4
  (settings + teacher portal restyle) is done and verified live.
- **Design system rollout**: Phases 1–4 of a visual/UX overhaul are shipped
  (finance, students/staff, academics/grading/report-cards, settings/teacher
  portal). Color tokens, fonts (Fraunces + Hanken Grotesk), and dark mode are
  documented in `CLAUDE.md`'s "Design system" section — read that before
  touching any restyled page.
- **Uncommitted working-tree change at handoff time** — `git status` shows
  `packages/db/prisma/dev-seed.ts` modified, NOT committed:
  - Adds a `JSS1_STUDENTS` const (7 students, admission numbers
    `NJC/2025/006`–`012`, continuing the existing JSS 2 A sequence) and a
    seed step that upserts them into the school and enrolls them in the JSS
    1 A class arm for the current term.
  - The in-code comment states this is deliberate: JSS 1 A roster exists for
    manual roster/attendance/gradebook UI testing (`dev-teacher` is JSS 1
    A's form teacher), and deliberately has NO scores/attendance fixture
    (unlike JSS 2 A, which backs the aggregation/ranking demo data).
  - **This diff has not been verified as run** (no confirmed `pnpm db:seed`
    execution, no commit, no PR). Before extending or discarding it, check
    with the maintainer whether it was finished or mid-edit — don't assume
    either way.
- **Known open item from `docs/deferred.md`** (not yet fixed, don't
  re-discover): `apps/web`'s `/api/auth/[...auth]/route.ts` (`login`,
  `signup-owner`, `2fa/challenge`) still returns the raw session token in the
  JSON response body alongside setting the `sk_session` HttpOnly cookie —
  `apps/portal`'s equivalent route already strips this. Deliberately
  deferred (not a same-shape drop-in fix; needs `AuthProvider` restructuring
  to re-derive the token from the cookie server-side instead). See
  `docs/deferred.md` for full detail and the trigger condition for fixing it.
- Check `docs/deferred.md` directly for anything more recent than this
  snapshot — it's the maintainer's live-updated running list, this file is
  frozen at the moment it was written.

## Returning to Claude Code

When the maintainer's Claude subscription renews and they resume with Claude
Code, tell it explicitly: "read `docs/CODEX_HANDOFF.md`'s Latest state
section and recent git log, then update your memory." Claude Code's memory
system will not automatically know what Codex did in the interim — it only
captures what happens in its own conversations.
