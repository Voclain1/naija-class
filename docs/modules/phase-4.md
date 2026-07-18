# Phase 4 — communication and parent portal

The phase where parents log in for the first time. Phase 3 was admin/bursar-
operated (staff record what parents pay); Phase 4 gives guardians their own
authenticated surface — a portal to view their children's invoices and fee
structure, pay via Paystack directly, and receive school communications
(email, SMS, in-app). ARCHITECTURE §9 estimates 3 weeks; treat that the same
way phase-3.md treated its own estimate — optimistic, not a ceiling.

No AI features yet (Phase 5). No assignment/student-portal surface yet
(Phase 6). Parents are the only new user type — staff-side admin/bursar/
teacher flows are unchanged.

**Locked scope decisions (this phase):**

- **D1 — Portal architecture.** A new `apps/portal` Next.js app in the
  monorepo, separate from `apps/web`. Deployed to Vercel at
  `portal.schoolkit.ng`. Parents never touch the admin app. Separate session
  management, separate middleware, separate UI. Shares `packages/types`,
  `packages/db`, and `packages/ui` with the existing apps.
- **D2 — Parent auth.** Guardians already exist in the DB (linked to students
  via Phase 1's `Guardian`/`StudentGuardian`). Admin links a guardian's email
  to their guardian record → system automatically sends an invitation email
  (via Resend) → guardian clicks link, sets password, gains portal access. No
  self-registration. No admission-number claiming.
- **D3 — Notifications.** Three channels — email (Resend, already wired), SMS
  (Termii for Nigerian numbers, new dependency), push (deferred to the mobile
  app phase). Preferences are per-school (each school can enable/disable
  channels). Notification types: invoice issued, payment received, payment
  overdue reminder, school announcements.
- **D4 — Parent payments.** Guardians log into the portal, see their child's
  invoices and fee structure (set by bursar in Phase 3), and can initiate
  Paystack payment directly. The flow creates a `Payment` record (same model
  as Phase 3) with `method: PAYSTACK`, linked to the invoice. The existing
  Paystack webhook (`charge.success`) already handles it — parent-initiated
  payments flow through the same webhook, no new webhook path.

**Follow-up decisions, locked 2026-07-12 (see §4):**
- **Decision A** settles the guardian auth data model — `Guardian` is
  extended directly, no companion table.
- **Decision B** settles guardian-to-student authorization — a
  `withGuardian()` helper in `packages/db`, layered on top of `withTenant()`.
- **Decision C** settles `Guardian.email` uniqueness — scoped per school.

**Still open** (not resolved by D1-D4 or A-C — see §4):
- The portal's authentication mechanism itself (how a request resolves to a
  `guardianId` in the first place — the session/guard plumbing, not the
  authorization check A/B/C cover). Slice 1 wires the cookie domain; the
  guard that reads it is slice 2's decision.
- The in-app messaging slice (ARCHITECTURE §9) has no shape at all yet — not
  even a data-model sketch. 1:1 admin↔parent, broadcast-only, or both?
  Real-time or polled? Left for that slice's own plan-first.

## Sequencing principle (de-risk early, same philosophy as Phase 3 §Sequencing)

- **The portal scaffold + deploy** is the biggest unvalidated technical
  unknown — a second Next.js app in the monorepo, a second Vercel project, a
  new subdomain, session cookies scoped separately from `apps/web`'s. Settle
  it before anything guardian-facing depends on it existing.
- **Guardian auth** lands before any portal screen shows real per-guardian
  data — mirrors Phase 3's "auth hardening before any finance slice."
  Payment is the highest-trust guardian action (real money, same as staff
  Paystack init in Phase 3) — its authorization scope must be right from the
  first line of guardian-facing service code, not retrofitted.
- **Notifications** (email/SMS wiring, preferences) can build in parallel
  with the portal once guardian auth exists, since sends don't require the
  guardian to be logged in — the trigger is invoice/payment events on the
  admin side.
- **Messaging** is last among the "communication" slices — it's the only
  piece with zero prior art in this codebase (no existing message/thread
  model anywhere) and the least specified by D1-D4.

## 1. Estimated time

ARCHITECTURE §9's "3 weeks" predates any of D1-D4's detail. Rough slice-count
comparison: Phase 3 shipped ~15 slices over ~48 raw build-days at Phase-2
pace. Phase 4 has less raw *volume* (no school-defined-flexibility problem
like fee catalog/discount rules) but two genuinely novel technical surfaces
(a second deployed app, a new authenticated user class with its own
authorization model) that Phase 3 never had to solve. Treat the ARCHITECTURE
estimate as optimistic in the same way phase-3.md treated its own — a real
number needs each slice's plan-first sized against actual velocity once
slice 1 closes.

## 2. Slice breakdown (draft — sequencing needs confirmation, not locked)

| # | Slice | Why it ships independently | Depends on |
|---|---|---|---|
| 1 | **`apps/portal` scaffold + deploy** — new Next.js app, Vercel project at `portal.schoolkit.ng`, shares `packages/types`/`packages/db`/`packages/ui`, empty shell (login page only, no working auth yet), CI wiring | The unvalidated unknown — multi-app Vercel deploy + subdomain + separate session-cookie scoping. Nothing guardian-facing is safe to build against a portal that doesn't deploy. | none |
| 2 | **Guardian auth** — migration for Decisions A + C (`Guardian` auth columns + scoped-unique email), the session/guard mechanism (still open, §4), admin-side "link guardian email → send invite" (extends or parallels the existing `Invitation` flow), guardian-side accept-invite/set-password/login | D2 + Decisions A/C. Every later portal screen needs a real, logged-in guardian identity to build against. | Slice 1 |
| 3 | **Guardian-to-student authorization layer** — wires `withGuardian()` (Decision B) into every parent-facing endpoint as it's built | Distinct correctness surface from RLS — a guardian seeing another family's child in the *same school* is a real leak RLS alone doesn't prevent. Isolating it as its own slice makes it independently testable (negative-walk tests) before any real data is exposed through it. | Slice 2 |
| 4 | **Parent view: invoices + fee structure (read-only)** — guardian portal home: linked children list, each child's invoices (from Phase 3's `Invoice`) and fee structure, no payment action yet | First real value delivered to a parent — "see what I owe" — with zero money-movement risk while the authorization layer is still fresh. | Slice 3 |
| 5 | **Parent payments (Paystack)** — D4 in full: guardian-initiated Paystack payment against their child's invoice, reusing `Payment`/webhook from Phase 3, new parent-facing init endpoint (distinct auth context from the bursar-facing one) | The highest-trust guardian action. Isolated after the read-only view is proven, same reasoning Phase 3 applied to refunds (isolate the money-movement act). | Slice 4 |
| 6 | **Notifications infrastructure** — D3: `NotificationPreference` (per-school channel toggles), Termii SMS integration, notification triggers (invoice issued, payment received, overdue reminder — the last one already exists as an email-only cron from Phase 3 slice 10; extend, don't rebuild), school announcement board (new model + admin CRUD + guardian-facing read) | Can build in parallel with slices 2-5 once guardian *contact info* (email/phone) is confirmed reachable — sends don't require the guardian to be logged in. | Slice 2 (needs guardian email confirmed valid via the invite-accept step) |
| 7 | **In-app messaging** — shape TBD at this slice's own plan-first (no existing model to extend; see the open gap above) | Least specified, most novel. Last, so its design isn't rushed to unblock anything else. | Slices 1-2 (portal + guardian identity must exist) |
| 8 | **Phase 4 close** — admin-side `@Permissions` for the new staff actions (link guardian, send announcement, configure notification preferences), audit coverage extension, guardian cross-tenant + cross-family negative-walk E2E, manual gates | The Phase-3-slice-15 equivalent — closes the phase, all gates green. | All prior slices |

This table is a draft, not a lock — call out slice reordering or splitting at
each slice's own plan-first, same as Phase 3 did (e.g. Phase 3 slice 12 was
narrowed mid-build).

**Reorder, confirmed at Slice 6's plan-first (2026-07-18):** Slice 6
(notifications) was built immediately after Slice 2 (guardian auth),
*before* Slices 3-5 (guardian-to-student authorization, read-only invoice
view, Paystack payments). This is consistent with the dependency column
above — Slice 6 lists only Slice 2 as a dependency, not Slices 3-5 — so the
reorder doesn't violate anything already locked, it just executes the
table's own stated parallelism ("can build in parallel with slices 2-5")
early rather than after. Slices 3-5 remain unbuilt as of this note. Flagging
explicitly because the *request* that kicked off Slice 6's build referred to
it informally as "Slice 3," which doesn't match this table — recorded here
so a future reader hitting that mismatch in a commit message, PR title, or
journal entry doesn't mistake it for undocumented drift.

## 3. Data model — first-cut, confirm at each slice's plan-first

### Guardian auth (slice 2) — locked (Decisions A & C, 2026-07-12)

`Guardian` is extended directly — no companion table (Decision A):
```prisma
model Guardian {
  // ...existing fields...
  passwordHash    String?   @map("password_hash")
  emailVerified   Boolean   @default(false) @map("email_verified")
  lastLoginAt     DateTime? @map("last_login_at")
  portalInvitedAt DateTime? @map("portal_invited_at")

  @@unique([schoolId, email])   // Decision C — scoped per school, see §4
}
```
`emailVerified` is `NOT NULL DEFAULT false` — every existing `Guardian` row
defaults cleanly, no backfill needed. The other three columns are nullable —
`NULL` is the correct, meaningful state for every guardian who predates
Phase 4 (never invited, never logged in).

`@@unique([schoolId, email])` (Decision C) means a guardian with children at
two schools gets two separate portal accounts, one per school — intentional,
not a gap. `email` stays nullable; Postgres treats multiple `NULL`s as
distinct, so uninvited guardians (`email IS NULL`) never collide against
this constraint.

```prisma
model GuardianSession {
  id         String   @id @default(uuid())
  guardianId String   @map("guardian_id")
  tokenHash  String   @unique @map("token_hash")
  ipAddress  String?  @map("ip_address")
  userAgent  String?  @map("user_agent")
  expiresAt  DateTime @map("expires_at")
  createdAt  DateTime @default(now()) @map("created_at")
  guardian   Guardian @relation(fields: [guardianId], references: [id], onDelete: Cascade)
  @@index([guardianId])
  @@map("guardian_sessions")
}
```
A parallel table, not a reuse of `Session` — `Session.userId` is a
non-nullable FK to `User`; widening it to cover guardians would drag the
staff RBAC/permissions machinery into a user class that never needs it. Not
yet locked as a decision in its own right (see §4's "still open" item) —
sketched here because it falls out directly of Decision A, but the
session/guard *mechanism* that writes and reads this table is slice 2's call.

### Guardian-to-student authorization — locked (Decision B, 2026-07-12)

```typescript
// packages/db/src/with-guardian.ts
async function withGuardian<T>(
  guardianId: string,
  studentId: string,
  db: PrismaClient, // already inside a withTenant(schoolId) context
  callback: (db: PrismaClient) => Promise<T>,
): Promise<T> {
  const link = await db.studentGuardian.findFirst({
    where: { guardianId, studentId, schoolId: /* from the withTenant context */ },
  });
  if (!link) throw new ForbiddenException();
  return callback(db);
}
```
Layered on top of `withTenant()`, not a replacement for it — `withTenant`
handles cross-school isolation (RLS); `withGuardian` handles cross-family
isolation *within* a school, which RLS was never designed to do. Every
portal endpoint returning student/invoice/payment data must call
`withGuardian` before touching the row. This is the one new correctness
surface every later slice (4, 5) depends on getting right — the
negative-walk test (guardian A cannot see guardian B's child in the *same*
school) is the acceptance bar, not just the cross-tenant walk.

### Notifications (slice 6) — first cut

```prisma
model NotificationPreference {
  id           String  @id @default(uuid())
  schoolId     String  @map("school_id")
  emailEnabled Boolean @default(true) @map("email_enabled")
  smsEnabled   Boolean @default(false) @map("sms_enabled") // Termii costs money — opt-in
  pushEnabled  Boolean @default(false) @map("push_enabled") // dark until the mobile phase
  updatedBy    String  @map("updated_by")
  updatedAt    DateTime @updatedAt @map("updated_at")
  @@unique([schoolId])
  @@map("notification_preferences")
}

model Announcement {
  id        String   @id @default(uuid())
  schoolId  String   @map("school_id")
  title     String
  body      String
  createdBy String   @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")
  @@index([schoolId, createdAt])
  @@map("announcements")
}
```
Whether individual notification *sends* need their own log table (for
delivery-status debugging) or can stay ephemeral (fire-and-forget via
Resend/Termii, relying on their own dashboards) — TBD at the slice-6
plan-first.

### Messaging (slice 7) — no schema yet, by design

Genuinely undesigned. Not sketched here — the shape depends on the 1:1-vs-
broadcast decision flagged in §4.

## 4. Architectural decisions

### Locked (2026-07-12)

**Decision A — Guardian auth model: extend `Guardian` directly.** Adds
`passwordHash TEXT NULL`, `emailVerified BOOLEAN NOT NULL DEFAULT false`,
`lastLoginAt TIMESTAMP NULL`, `portalInvitedAt TIMESTAMP NULL` to the
`guardians` table. No separate `GuardianAccount` table. See §3 for the full
field list and the reasoning (consistency with how `User` already blends
profile + auth in one table).

**Decision B — Guardian-to-student authorization: `withGuardian()` helper.**
A `withGuardian(guardianId, studentId, db, callback)` helper in
`packages/db` verifies a `student_guardians` row exists for
`(guardian_id, student_id)` within the current tenant, throws
`ForbiddenException` if not, and calls `callback(db)` if authorized. Every
portal endpoint returning student/invoice/payment data must go through it.
`withTenant` handles school isolation; `withGuardian` handles guardian-to-
student authorization within the school — two distinct, composed layers,
not one replacing the other. Full spec in §3.

**Decision C — `Guardian.email` uniqueness: `@@unique([schoolId, email])`.**
Scoped per school, not global. A guardian with children at two schools gets
two separate portal accounts — intentional, not a gap to close later.

### Still open

1. **Guardian session/guard mechanism** — Decision A gives us the
   `GuardianSession` table shape (§3) as a natural consequence, but *how* a
   portal request resolves to a `guardianId` — the actual guard/middleware
   reading the session cookie — is not decided. Confirm whether the guard
   lives in `apps/api` (a new NestJS guard class alongside the existing
   `AuthGuard`) or is portal-app-side only. This determines whether slice 2
   needs new `apps/api` guards, or whether slice 1's "empty shell" is
   emptier than it sounds. Blocks slice 2's plan-first, not slice 1.
2. **In-app messaging shape** — 1:1 vs broadcast, real-time vs polled. Zero
   prior art in this codebase to anchor a default; needs its own
   decision before slice 7's plan-first, not before slice 1.
3. **WhatsApp vs SMS primacy** (ARCHITECTURE.md open-Q #5) — D3 already
   settled *that* Termii/SMS ships; it did not settle whether WhatsApp
   Business (via Termii) ships alongside SMS in slice 6 or is deferred
   further. WhatsApp Business API approval is an external, non-controllable
   timeline (CLAUDE.md's "not covered yet" list) — worth confirming this
   doesn't gate slice 6's start date before locking that slice's scope.
   **Resolved for slice 6's actual scope (2026-07-18): SMS only, via
   Termii's `dnd` channel.** Not a decision against WhatsApp permanently —
   just not this slice, consistent with §5's existing "carries forward as
   deferred" framing. Revisit once/if WhatsApp Business approval lands.
4. **`apps/portal` in CLAUDE.md's monorepo layout** — CLAUDE.md's `apps/`
   diagram currently lists only `web`/`mobile`/`api`. Needs a documentation
   update in the same PR as slice 1, not left implicit.

## 5. Deferred to later phases

- **AI-assisted parent summaries / tutor** — Phase 5.
- **Push notifications** — explicit in D3, deferred to the mobile app phase
  (Phase 6 territory or later, whenever `apps/mobile` gets parent-facing
  screens).
- **Assignment visibility for parents** — Phase 6 (student portal phase)
  owns assignments; Phase 4 is fee/communication only.
- **WhatsApp Business** (if not confirmed for slice 6 per §4's "still open"
  item 3) — carries forward as an explicit deferred item, not silently
  dropped.

## 6. Acceptance criteria — draft, confirm at Phase 4 close

Modeled on phase-3.md §15's bar, adapted:

1. Every slice closed via the cp pattern (plan-first → build → manual gate
   → commit → PR → merge).
2. `apps/portal` deployed and reachable at its production subdomain.
3. A guardian can be invited, accept, set a password, and log in — with no
   self-registration or admission-number-claiming path existing.
4. A guardian sees **only** their own linked children's invoices/fee
   structure — cross-family and cross-tenant negative-walk tests both pass.
5. A guardian-initiated Paystack payment correctly updates the same
   `Invoice`/`Payment` records the bursar-initiated path updates, through the
   same webhook, with no duplicated logic.
6. Notification preferences are enforced — a school with SMS disabled sends
   no Termii messages regardless of event type.
7. Every new admin-side action (link guardian, send announcement, configure
   preferences) carries `@Permissions`, verified by
   `permissions-coverage.spec.ts`.
8. Every new mutation writes to `audit_logs`, verified by an extended
   `audit-coverage.spec.ts`.

---

## 7. Slice 1 plan-first decisions (locked 2026-07-12)

These decisions were finalized at the plan-first and are building constraints
for CP1/CP2. Reopen only if a concrete blocker surfaces.

**D1 — Package set: mirror `apps/web`'s `package.json`, minus what slice 1
doesn't exercise yet.** Same `next`/`react`/`react-dom`/`typescript`/
`tailwindcss`/`@school-kit/types`/`@school-kit/ui`/`@school-kit/config` base.
Excluded from slice 1: `react-hook-form`, `zod` (no real form logic until
slice 2's login/invite-accept), `@tanstack/react-query` (no data-fetching
until slice 4).

**D2 — No `packages/db` dependency, despite the phase-level D1's phrasing.**
`apps/web` has no `@school-kit/db` dependency and nothing in its
`next.config.mjs` transpiles it — it talks to `apps/api` over HTTP only,
per CLAUDE.md's "Server actions vs API" rule. `apps/portal` follows the
identical pattern: `packages/types` + `packages/ui` only, no direct DB
access from Next.js server components.

**D3 — Vercel project: new, separate from `school-kit-web`.** No
`vercel.json` exists for `apps/web` either — Vercel is dashboard-configured
(Root Directory setting), not in-repo. `apps/portal` gets its own Vercel
project (`school-kit-portal`), Root Directory `apps/portal`, with
`portal.schoolkit.ng` attached as a custom domain (DNS CNAME, user-
provisioned prerequisite). No changes to `deploy-staging.yml` — that
workflow deploys only the Fly API/render-worker; Vercel's own GitHub
integration handles both Next.js apps independently.

**D4 — CORS on `apps/api` needs a second origin.** `main.ts`'s
`corsOrigin` is a single string wrapped in an array today — only one
frontend origin is allowed. New env var `CORS_ORIGIN_PORTAL`; `origin:
[corsOrigin, corsOriginPortal].filter(Boolean)` so a missing portal origin
(e.g. before slice 1 ships) doesn't break the existing web origin.

**D5 — Cookie domain: explicit `portal.schoolkit.ng`, not a wildcard.**
Locked, and elevated to `docs/ARCHITECTURE.md` §12 (a new "Cookie and
session strategy" section, since none existed) because it's a policy that
applies beyond this one slice: the portal's session cookie must not be
readable by any other subdomain, and vice versa — no shared-domain
short-cuts even though `apps/web` and `apps/portal` sit under the same
registrable `schoolkit.ng`. `Domain=portal.schoolkit.ng` exactly, never
`Domain=.schoolkit.ng`. Slice 1 proves this mechanically (not just as
configuration) with a throwaway route handler
(`apps/portal/app/api/dev-cookie-check/route.ts`) that sets and reads back a
test `httpOnly` cookie scoped to the exact domain, verified against the real
production host — a cookie's `Domain` attribute must match the actual
serving domain or the browser silently refuses to set it, which fails
differently (and more confusingly) on a Vercel preview URL than on the real
domain. Deleted once slice 2's real `GuardianSession`-backed mechanism
lands. This is slice 1's equivalent of Phase 3 slice 1's render-memory
gate — settle the unvalidated unknown before anything depends on it.

**D6 — A dedicated health route.** `app/api/health/route.ts` returning
`{ status: "ok" }` — mirrors `apps/api`'s own `/health`, cleaner for the
smoke test to assert against than homepage-content sniffing.

**D7 — Smoke test gets a new op, gated and tolerant of deploy-timing.**
Op 6 in `scripts/smoke-test.sh`: `GET ${SMOKE_PORTAL_URL}/api/health` → 200,
same 10×5s retry loop as Op 1. Known limitation, not hidden: Vercel's portal
deploy is triggered independently of the GH Actions run that deploys the Fly
API, so there's no hard ordering guarantee the portal's latest deploy has
finished when this step runs — the retry loop absorbs *typical* latency,
not a guarantee. Revisit if this op flakes in practice.

**D8 — New env vars.** `.env.example` gains `CORS_ORIGIN_PORTAL=http://
localhost:3002` (dev). `NEXT_PUBLIC_API_URL` is reused as-is — portal hits
the same API `apps/web` does. `SMOKE_PORTAL_URL` reserved for the deploy
workflow's secrets, mirroring `STAGING_API_URL`'s existing pattern.

**D9 — Dev port: 3002.** `apps/web` already owns 3001 (port 3000 is
squatted by another local process — see `env_port_3000` memory). `apps/
portal` gets `next dev --port 3002`; `pnpm dev:portal` added to the root
`package.json`.

**CP breakdown:**

- **CP1 — Scaffold + local dev (no deploy yet):**
  - `apps/portal/package.json`, `tsconfig.json` (extends
    `@school-kit/config/tsconfig.next.json`), `next.config.mjs`
    (`transpilePackages: ["@school-kit/ui", "@school-kit/types"]`),
    `tailwind.config.ts` + `postcss.config.mjs` (copied from `apps/web`,
    content globs adjusted to `apps/portal/src`).
  - `app/layout.tsx` (root layout, shared Tailwind globals), `app/login/
    page.tsx` (static shell — form markup, no submit handler wired; real
    auth is slice 2).
  - `app/api/health/route.ts` (D6).
  - `app/api/dev-cookie-check/route.ts` (D5) — GET sets the probe cookie
    with `Domain=portal.schoolkit.ng`, a second GET reads it back; manual-
    gate-only, not asserted by the automated smoke test.
  - `apps/api`: `CORS_ORIGIN_PORTAL` env var + `main.ts` origin-array change
    (D4).
  - Root `package.json`: `dev:portal` script. `.env.example` updates (D8).
  - Local gate: `pnpm dev:portal` boots on :3002, `/login` renders, `curl
    localhost:3002/api/health` → 200. Domain-scoping itself can't be fully
    proven pre-deploy (localhost isn't `portal.schoolkit.ng`) — CP2's manual
    gate is where D5 actually gets verified.

- **CP2 — Vercel + DNS + smoke test + manual gate:**
  - New Vercel project (`school-kit-portal`), Root Directory `apps/portal`,
    env vars mirrored from the `apps/web` Vercel project.
  - DNS CNAME for `portal.schoolkit.ng` → Vercel, domain attached in the
    Vercel dashboard.
  - `scripts/smoke-test.sh` Op 6 (D7); exact CI wiring for `SMOKE_PORTAL_URL`
    confirmed at CP2 time — may not need a new GH Actions job at all if
    Vercel's own deploy-check suffices.
  - CLAUDE.md's monorepo layout diagram updated to list `apps/portal`.
  - **Manual gate:** visit `https://portal.schoolkit.ng/login` in a real
    browser (the actual domain, not a preview URL — D5 is specifically about
    proving *that* domain's cookie scoping); confirm the dev-cookie-check
    route round-trips on the real domain; confirm the cookie is **not**
    present/readable when inspected from `apps/web`'s origin (the negative
    check that actually proves the isolation, not just that a cookie got
    set); confirm `/api/health` returns 200 from the public URL; confirm the
    existing `apps/web` origin still works against the API (CORS regression
    check).

---

## 8. Slice 6 plan-first decisions (locked 2026-07-18)

Built immediately after Slice 2, ahead of Slices 3-5 — see the reorder note
under §2. Scope narrowed from the full "Slice 6" description in §2/§3: this
pass covers channel infrastructure and one real trigger, not every
notification type D3 names.

**D1 — Channel scope: email + SMS only, no WhatsApp, no push.** WhatsApp
resolved out of this slice's scope (§4 "still open" item 3, updated
2026-07-18) — SMS via Termii's `dnd` (transactional) channel covers D3's
SMS requirement without the WhatsApp Business approval dependency. Push
stays a dark `pushEnabled` column per D3, unchanged.

**D2 — Trigger scope: guardian-invite email/SMS + extend the existing
overdue-reminder cron. `invoice issued`/`payment received` hooks and the
`Announcement` model/CRUD/guardian-read screen deferred.** Neither of the
latter two exists as a hook anywhere in the finance module yet, and
`Announcement` is a full new feature (schema + admin UI + a portal-facing
read screen the portal doesn't otherwise have before slice 4's dashboard)
bundled into §2's Slice 6 description alongside what's really "wire the
channels" work. Splitting keeps this pass to: (a) guardian invite finally
sends real email (closes `docs/deferred.md`'s "Wire Resend for real
invitation email delivery") and SMS, both gated by preference; (b)
`FinanceService.sendReminders` (Phase 3 Slice 10, currently unconditional)
now checks `NotificationPreference` before sending, and gains an SMS
variant. `invoice issued`/`payment received` triggers and `Announcement`
remain open — carried forward as their own follow-up slice, not silently
dropped.

**D3 — `NotificationPreference` as a separate table, matching §3's
first-cut sketch.** First departure from the flat-column-on-`School`
pattern (`subjectAttendanceEnabled` is the only prior per-school toggle,
and it's a bare column) — justified here by the `updatedBy`/`updatedAt`
audit fields, which don't fit cleanly as bare `School` columns. RLS ships
inline in the migration SQL (the `packages/db/prisma/policies/` directory
stopped being updated after Phase 2 — pre-existing gap, not fixed by this
slice), following the `grading_schemes` flat-`school_id` tenant-isolation
pattern. No SECURITY DEFINER function needed — ordinary tenant-scoped
table, count stays at 10.

**D4 — Termii credentials: platform-wide, one account.** Mirrors
`PAYSTACK_SECRET_KEY` (single platform key, not per-school). No signal in
D3 or ARCHITECTURE.md suggests per-school Termii accounts; per-school SMS
credential provisioning would be a real operational burden the phase
doesn't otherwise ask for. `.env.example`'s existing `TERMII_API_KEY`/
`TERMII_SENDER_ID` slots are used as-is; a school just toggles `smsEnabled`
and the platform bears the Termii cost (billing that back to schools is a
business-model question, out of scope here).

**D5 — New `apps/api/src/modules/notifications/` module, not grown inside
`finance.service.ts`.** `finance.service.ts` is the highest-churn file in
`apps/api/src/modules` (touched in nearly every recent Phase 3 commit) and
notification dispatch/preferences is a distinct bounded concern from
finance calculation — a new module reduces collision risk and keeps the
boundary clean. `FinanceService.sendReminders` calls into the new module
rather than the reverse.

**D6 — Termii wrapper, confirmed against live docs before writing code
(per instruction, not assumed from training data):**
- Endpoint: `POST {TERMII_BASE_URL}/api/sms/send`. **Base URL is
  per-account** (Termii dashboard-assigned, not a fixed global constant
  like Paystack's `api.paystack.co`) — new env var `TERMII_BASE_URL`,
  defaulting to `https://api.ng.termii.com` (the commonly-documented
  Nigeria-region value) but must be confirmed against the actual
  provisioned account before a real send is attempted in any environment.
- Body: `{ api_key, to, from, sms, type: "plain", channel: "dnd" }`. `dnd`
  (transactional), not `generic` (promotional-only, Termii's own docs warn
  it silently fails DND-registered numbers and shouldn't carry OTP/
  transactional content) — every message this slice sends (invite links,
  fee reminders) is transactional.
- `to` must be international format with **no leading `+`** (e.g.
  `2347015250000`). **Real gap found while confirming this: `Guardian.phone`
  has zero format validation** (`z.string().trim().min(1).max(30)` —
  `packages/types/src/guardians/create-guardian.dto.ts:27`), so stored
  values could be local (`080...`), international with or without `+`, or
  malformed. The wrapper needs its own normalization (strip non-digits,
  handle a leading `0` → `234` swap for the common Nigerian-local case,
  strip a leading `234`'s redundant `+`) and must treat unrecognized shapes
  as a send failure to log, not a garbage request to Termii.
- Success shape: `{ code: "ok", balance, message_id, message, user,
  message_id_str }`. Failure signal is layered: non-2xx HTTP status is
  authoritative (Termii's own docs: 2xx/4xx/5xx are meaningful), but a 2xx
  response can still carry a non-`"ok"` `code` — check both, matching how
  `PaystackService` checks `res.ok` then `json.status`.
- `from` (sender ID) reuses `TERMII_SENDER_ID=SchoolKit` already in
  `.env.example` (8 chars, within Termii's 3-11 char alphanumeric limit).
- No delivery-status webhook this slice — §3's "TBD" on a send-log table
  resolved as: stay ephemeral (fire-and-forget, rely on Termii's own
  dashboard), matching Paystack's no-retry precedent.

**D7 — Testing without live Termii credentials: stub-at-consumer, mirroring
`payments.service.spec.ts`'s `makePaystackStub()`.** No HTTP mocking
library, no live sandbox account in this environment (`.env.example`'s
`TERMII_API_KEY=replace-me` is still a placeholder). Consumers
(guardian-invite service, reminder service) get a hand-built stub object
with overridable methods injected in place of the real `TermiiService`/
`ResendService`. Preference-enforcement logic itself (the phase's
acceptance criterion — §6 item 6) needs zero external dependency and gets
the most direct coverage. Also closes a pre-existing gap:
`FinanceService.sendReminders`'s real `resend.emails.send` call
(Phase 3 Slice 10) has never had a test asserting the actual send path,
only the "skipped, no key" branch — this slice's tests cover it where the
old finance spec didn't.

---

*Per-slice plan-firsts happen as each slice approaches — this doc is the
phase map, not the slice specs. Decisions A-C (§4) unblock slice 1's
plan-first, now locked above. The remaining "still open" items in §4 don't
block slice 1 — they block slice 2 (session mechanism) and slice 7
(messaging) respectively, and should be settled at those slices' own
plan-firsts. Slice 6's own plan-first decisions are locked in §8, reordered
ahead of slices 3-5 per the note under §2.*
