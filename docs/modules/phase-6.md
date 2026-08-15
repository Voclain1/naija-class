# Phase 6 — mobile app, student portal, guardian mobile

**Status:** plan-first, awaiting review. Nothing implemented.
**Created:** 2026-08-15

---

## 0. Document provenance — READ THIS FIRST

This is a plan-first written *before* any code, in the same discipline
Phase 5 used. Unlike phase-5.md — which was partly reconstructed after the
fact, and carries `[recovered]` / `[gap]` markers on its decisions — every
decision here is `[proposed]` until reviewed, then `[locked]` with a date.
No decision in this document has been implemented against.

Read alongside:

- `docs/ARCHITECTURE.md` §6.1 (identity), §7 (AI architecture), §9 (phases),
  §12 (cookie and session strategy)
- `CLAUDE.md` — hard rules on multi-tenancy, money, auth, AI
- `docs/DECISIONS.md` — ADR-002, which already settles mobile auth transport
- `docs/modules/phase-4.md` — the guardian portal, whose auth this phase
  mirrors (mirrors, not reuses — see §6)

---

## 1. Scope

**Phase 6 is: the mobile app becomes real, students become a principal the
system recognises, and guardians get a native experience.**

Three things, one phase, because they share one binary and one auth layer:

1. **Mobile shell** — `apps/mobile` goes from a 5-file Phase 0 scaffold to a
   shippable app: dependency alignment, real assets, EAS build config, an
   API client, secure token storage, navigation, the design system, and CI
   quality gates that actually run.
2. **Student portal** — the student principal. `Student` currently has no
   `passwordHash`, no session relation, and no role. A student cannot log in
   to anything, anywhere. This phase makes them a first-class authenticated
   subject with a deliberately small read-only surface.
3. **Guardian mobile** — the parent experience on a phone. The API for this
   already exists and works (§8); this is overwhelmingly client-side.

**Offline resilience is a first-class constraint across all three**, designed
in from slice 1 rather than retrofitted. See §7 — it is the longest section
in this document on purpose.

### What this phase is NOT

- **Not the AI tutor.** That is Phase 7, held pending the embeddings vendor
  decision. No `CurriculumChunk`, no `TutorSession`, no `pgvector` work, no
  `MasteryRecord.topicRef` grain decision. If a slice here starts reaching
  for any of those, it has gone out of scope.
- **Not assignments.** The original `ARCHITECTURE.md` §9 Phase 6 paired
  "assignments" with "student portal". The student-portal half is absorbed
  here because it is the blocking dependency; assignments are renumbered to
  Phase 8 and stay there.
- **Not offline writes.** See D9. This is a deliberate, argued boundary, not
  an omission.
- **Not a teacher mobile app.** Teachers have a working web surface. Adding a
  third principal to a brand-new app triples the auth surface for the least
  demonstrated need.

---

## 2. Estimated time

Phase 5's §1 recalibration is the model for how to write this honestly, so:
these are **engineering days**, and the calendar figure is separate and
larger, for reasons named below.

| Slice | Scope | Estimate |
|---|---|---|
| 1 — Mobile foundation | Dependency alignment, assets, EAS, API client, secure storage, nav, design tokens, offline cache layer, real CI gates | 6–8d |
| 2 — Guardian mobile | Login + children + student detail + invoices + payment handoff, against the existing `/portal` API | 5–6d |
| 3 — Student principal | Schema, `StudentSession`, 2 SECURITY DEFINER fns, guardian-mediated activation, login, RLS, permissions, tests | 6–8d |
| 4 — Student mobile surface | Own results, attendance, fee status | 4–5d |
| 5 — Push notifications | Expo Push, device registration, wire to the existing `notifications` module | 4–5d |
| 6 — Store submission | Developer accounts, privacy labels, NDPR disclosures, build + submit | 3–5d eng |

**≈ 28–37 engineering days ≈ 6–7.5 weeks of pure build.**

**Calibrated calendar estimate: 10–14 weeks.** Weight toward the top. The
multiplier is not padding — it is this project's own measured behaviour, and
Phase 5 is the evidence. Phase 5's slices came in *under* their engineering
estimates (≈10 actual days against ≈19.5 estimated) and the phase still ran
long, because the calendar went to firefighting: the four-week CI e2e
timeout, `STORAGE_DRIVER` never set in production, the missing
`PORTAL_BASE_URL` Fly secret, the recreated Vercel project's vanished
environment variables.

Three specific reasons to expect the same pattern here:

1. **Two new deployment surfaces.** App Store and Play Console are both new,
   and `docs/deferred.md` records "config added to the repo but never
   verified against the actual deployed environment" happening three times
   already. A mobile build has *more* environment-dependent configuration
   than a web deploy, not less.
2. **Store review latency is 1–3 weeks and entirely outside your control.**
   It is not in the engineering estimate above and cannot be compressed by
   working harder. Start the developer accounts during slice 1.
3. **Slice 3 is auth code against a new principal type under FORCE RLS.** It
   is the least compressible estimate here and the one most likely to
   overrun. Treat it accordingly.

---

## 3. Sequencing principle

Same two rules that drove Phase 5, plus one this phase adds.

**Infrastructure before the first screen.** The API client, secure token
storage, the offline cache layer, and the CI gates all land in slice 1,
before any feature screen exists. Same deliberate inversion as Phase 5's
slice 1: retrofitting an offline cache onto six shipped screens means six
call sites to find and "did we get them all?" is not a question you can
answer confidently. Retrofitting it onto zero screens is free.

**Features in order of dependency, ascending.** Guardian mobile (slice 2)
comes before student anything, because its entire API surface already exists
and works — it is the cheapest possible proof that the shell in slice 1 is
correct, against a real backend, with real data. Discovering the API client
is wrong is much cheaper in slice 2 than in slice 4.

**New for this phase: the risky, unfamiliar thing goes early.** Store
submission is slice 6 by *sequence* but its account setup starts in slice 1,
because its latency is external. This is the one place where "do it last"
would be actively wrong.

---

## 4. Slice breakdown

### Slice 1 — Mobile foundation

`apps/mobile` today is 5 source files: one screen, one `<Stack>` layout, and
config. Four things are broken or divergent, and all four are slice-1 work:

- **`app.json` references assets that do not exist** — `./assets/icon.png`,
  `./assets/splash.png`, `./assets/adaptive-icon.png`. There is no
  `assets/` directory. Any real build fails here, so this blocks slice 6
  from day one.
- **React version divergence** — mobile pins `react: 18.3.1`; the monorepo
  is React 19. `packages/ui` and `packages/types` are shared. This is a real
  constraint on code sharing (D3).
- **`lint` and `test` are `echo` placeholders** — mobile is currently outside
  every CI quality gate, and Turbo reports it as passing. This is the
  `pnpm lint`-not-run failure mode already in memory, institutionalised in
  a package script.
- **Expo SDK 52 / RN 0.76.5** was current when Phase 0 shipped in May 2026.
  Upgrading before writing screens is dramatically cheaper than after (D2).

Also lands: the API client (bearer, mirroring `apps/web/src/lib/api-client.ts`
shape), `expo-secure-store` token storage, TanStack Query + persister
(§7), navigation shell, and the design tokens from the design-system
initiative — Paper / Ink / Deep Emerald / Gold Spark, Fraunces + Hanken
Grotesk. Note fonts load differently on Expo (`expo-font`) than
`next/font/google`; the token *values* are shared, the loading mechanism is
not.

#### Slice 1 progress — CI gates and SDK upgrade **[DONE 2026-08-15]**

The gate-closure and D3 halves of slice 1 are complete and verified. What
landed:

- **`assets/`** — four PNGs derived from the shared brand kit
  (`apps/web/public/brand/`) by a committed, re-runnable script,
  `scripts/generate-assets.mjs`. The generated files are committed too: EAS
  must not depend on the script having been run.
- **Real `lint`** — `eslint . --max-warnings=0` against a new shared
  `@school-kit/config/eslint/expo` preset, replacing `echo 'lint
  placeholder'`. Deliberately not built on the Next preset (no DOM, no
  jsx-a11y). The config file is `eslint.config.mjs`, not `.js`, because an
  Expo app cannot set `"type": "module"` the way apps/web and apps/portal do
  — Metro and Babel require their configs to stay CommonJS.
- **Real `test`** — Vitest, replacing `echo 'test placeholder'`. First spec is
  `__tests__/app-config.spec.ts`: asset existence, the iOS no-alpha rule, the
  Android 66% safe-zone rule, identifier/scheme invariants. Component tests
  are explicitly deferred to slice 2, which owns the jest-expo-vs-Vitest
  decision.
- **Stricter typecheck** — `tsconfig.json` now extends
  `@school-kit/config/tsconfig.expo.json`, which was previously dead *and
  unusable* code (it extended `expo/tsconfig.base`, which cannot resolve from
  `packages/config`). Adds `noUncheckedIndexedAccess`.
- **Expo SDK 52 → 57**, React 18.3.1 → 19.2.3, RN 0.76.5 → 0.86.2. See D3.
- **`splash` migrated out of `app.json`** into the `expo-splash-screen`
  config plugin — the top-level key was removed in SDK 54+ and `expo config`
  now hard-fails on it. The spec asserts its absence so it cannot come back.

Verified: `expo-doctor` 21/21; `expo export --platform web` bundles (774
modules, static routes render); repo-wide `pnpm lint` 9/9, `pnpm typecheck`
14/14, `pnpm test` 13/13 tasks green.

Each new gate was also verified to **fail** when broken — a deleted asset, an
alpha channel on the icon, artwork outside the Android safe zone, an unused
import, and a type error each produce a red build. A gate that has only ever
been observed passing is not known to be a gate; that was the original
defect.

#### Slice 1 — foundation modules **[DONE 2026-08-15]**

- **Design tokens** (`src/theme/`) — the CLAUDE.md palette and type scale as
  RN values, plus a `ThemeProvider` that follows the OS colour scheme.
  Deliberately no in-app light/dark toggle: on a phone the OS setting *is*
  the user's stated preference, and a second control mostly creates a way to
  disagree with it. Web needs a toggle for reasons that don't apply here.
- **API client** (`src/lib/api/client.ts`) — bearer-only per ADR-002, so no
  server change was needed. Two deliberate departures from the web client:
  the token arrives through an **injected provider** rather than a module
  global, which keeps the file free of any React Native import and therefore
  unit-testable; and unauthorized notification is a listener registry rather
  than `window.dispatchEvent`. It also distinguishes `ApiNetworkError`
  (request never reached the server) from `ApiError` (server considered and
  rejected it) — collapsing those is how "you have no fees" gets rendered to
  someone who simply has no signal.
- **Secure token storage** (`src/lib/auth/token-store.ts`) —
  `expo-secure-store` (Keychain/Keystore), never `AsyncStorage`, which is
  plaintext on disk. Keeps an in-memory mirror so the API client can read the
  token synchronously instead of putting a native round-trip in front of every
  request. Boot hydration is timeout-guarded: the splash is held until it
  resolves, so an unbounded keychain hang would be indistinguishable from a
  crash.
- **Offline cache layer** (`src/lib/query/`) — D9–D12. Policy is split from
  storage wiring specifically so the policy is testable in node.
- **Freshness** (`src/lib/freshness.ts`, `src/components/freshness-label.tsx`)
  — D11's "as of <time>", as an always-visible line rather than a conditional
  warning, since a banner that only appears when something is wrong trains
  people not to look for it.
- **Navigation shell** (`app/_layout.tsx`) — providers, brand fonts via
  `@expo-google-fonts` (shipped as npm packages, so no runtime call to
  Google's CDN — the same guarantee `next/font` gives web, by a different
  mechanism), splash held until ready.
- **`eas.json`** + `apps/mobile/BUILD.md` for the reasoning EAS's JSON can't
  carry.

**The D9 trap worth knowing about.** TanStack Query's *default* mutation
`networkMode` is `"online"`, which **pauses** a mutation fired while offline
and replays it on reconnect. That is an offline write queue — exactly what D9
rules out — and it would have been switched on by default with no code of ours
involved. Writes are set to `networkMode: "always"` so they fail immediately
instead, `retry: 0` so a money-mutating request is never silently re-sent, and
`shouldDehydrateMutation: () => false` so a paused mutation can't survive a
restart. Three independent places, because the failure mode is a payment
firing hours after the user tapped the button. `client.spec.ts` locks all of
it in, and was verified to fail when the setting is removed.

**A real bug caught by checking the render rather than the build.** `expo
export` reported success and "Static routes (3)" while emitting pages with an
**empty body** — the root layout holds rendering until an effect sets
readiness, and effects don't run during prerendering. `web.output` moved from
`"static"` to `"single"`, which is what an app behind a login actually is.
Verified by serving the export and loading it in a real browser: content
renders, Fraunces and Hanken Grotesk apply, Paper/Deep Emerald tokens are
correct, zero page errors.

**Slice 1 is complete.** Verification: `expo-doctor` 21/21 · `expo export`
bundles (926 modules) · browser render confirmed · repo-wide `pnpm lint` 9/9,
`typecheck` 14/14, `test` 13/13 tasks (1529 API + 48 mobile).

Not done, and not slice 1's to do: `eas init` (needs the Apple/Google
developer accounts, which have 1–3 week external latency and are being started
in parallel).

### Slice 2 — Guardian mobile

**The API is already built.** Seven endpoints, all working in production:

```
POST /portal/login
GET  /portal/invitations/:token
POST /portal/invitations/:token/accept
GET  /portal/students
GET  /portal/students/:id
GET  /portal/students/:id/invoices
POST /portal/students/:id/invoices/:invoiceId/pay
GET  /portal/payments/:reference
```

`AuthGuard`-equivalent session resolution already runs off a bearer token
(`auth_resolve_guardian_session`), and ADR-002 already specifies mobile as
bearer-only. **So guardian mobile needs zero API changes** (D14). This makes
it the cheapest slice with the highest proof value.

Payment is a Paystack handoff, and it stays a handoff — see D9 and §7 on why
a payment is never, under any circumstance, queued offline.

### Slice 3 — Student principal

The largest and riskiest slice. Full data model in §5, auth model in §6.

### Slice 4 — Student mobile surface

Deliberately small: a student sees their own results, their own attendance,
and their own fee status. Read-only. No messaging, no submissions, no
profile editing. The surface exists to justify the principal, not to be
comprehensive — and every additional endpoint is a new place to get "can
this student see this row?" wrong.

### Slice 5 — Push notifications

`ARCHITECTURE.md` §5 specifies Expo Push. Nothing exists yet — confirmed by
searching `apps/api` and `packages/`: no push infrastructure of any kind.

There is a real commercial argument for prioritising this over any other
"nice to have": **the platform currently reaches parents via Termii SMS,
which costs money per message. Expo Push is free.** For a Nigerian school
sending daily attendance alerts to hundreds of parents, moving even a
fraction of that volume from SMS to push is a direct, recurring margin
improvement. Push does not replace SMS — a parent without the app installed
still needs SMS — but it should become the preferred channel where
available, falling back to SMS.

### Slice 6 — Store submission

Apple and Google developer accounts, `eas.json` build profiles, privacy
nutrition labels, and NDPR disclosures. The privacy labels are not a
formality here: this app handles children's data, which triggers additional
declarations on both stores.

---

## 5. Data model

### Student principal (slice 3)

Added to the existing `Student` model rather than a separate account table
(D7):

```
passwordHash    String?    @map("password_hash")   // null until activated
activatedAt     DateTime?  @map("activated_at")    // event moment
lastLoginAt     DateTime?  @map("last_login_at")   // event moment
```

New table, mirroring `GuardianSession`:

```
model StudentSession {
  id         String   @id @default(uuid())
  studentId  String   @map("student_id")
  tokenHash  String   @unique @map("token_hash")
  expiresAt  DateTime @map("expires_at")
  createdAt  DateTime @default(now()) @map("created_at")
  ...
  @@map("student_sessions")
}
```

**No `school_id` column on `student_sessions`** — deliberately mirroring
`sessions` and `guardian_sessions`. `school_id` comes from the join to
`students`. Consistency with the two existing session tables matters more
than saving a join.

`Student` already carries `@@unique([schoolId, admissionNumber])`, which is
what makes D5's login identity work.

---

## 6. Auth model

### Transport: already decided, zero new work

ADR-002 and `ARCHITECTURE.md` §12 already settle this:

> `| apps/mobile | Authorization: Bearer header only (ADR-002) | N/A — no cookies, no domain concern. |`

The NestJS `AuthGuard` reads `Authorization: Bearer` directly — the cookie in
`apps/web` lives in the Next.js proxy route, never in the API. Mobile calls
the same endpoints with the same header. **No API-side transport change is
required for either principal.** The mobile-specific piece is storage:
`expo-secure-store` (iOS Keychain / Android Keystore), never `AsyncStorage`,
which is unencrypted plaintext on disk.

### Identity: the actual work

Reuse is the wrong frame. The guardian portal is a **template to mirror**,
not a system to share — a student is not a guardian, and collapsing them
would put a child and an adult on the same credential and permission path.

Two new SECURITY DEFINER functions, following the narrow-single-caller
discipline the Slice 12 audit settled on:

| Function | Returns | Deliberately omits |
|---|---|---|
| `auth_resolve_student_session(token_hash)` | `{ session_id, student_id, school_id, expires_at, student_is_active }` | `password_hash`, names, DOB, contact fields, medical notes |
| `auth_lookup_student_for_login(school_code, admission_number)` | `{ student_id, school_id, password_hash, is_active, activated_at }` | Everything else on `Student` — this row is PII-dense and the login path needs almost none of it |

**SECURITY DEFINER count moves 17 → 19.** The cadence note in `CLAUDE.md`
sets the next shape review at 20. Phase 6 lands one short. Flag it now so it
is not missed a sixth time.

**One inherited mistake explicitly not repeated.** `auth_lookup_guardians_
for_login` is the table's only multi-row function — a consequence of
Decision C's per-school email uniqueness, forcing the login service to
`argon2.verify` against every returned hash in turn. That was documented as
an interim strategy pending a real fix. **The student equivalent is
single-row by construction** (D5), because `(school_id, admission_number)`
already carries a unique constraint. Do not copy the guardian pattern here
just because it is the nearest example.

---

## 7. Offline resilience

**First-class design constraint, not a later pass.** The reasoning is
specific rather than general: this platform's stated context is Nigerian
private schools. That means intermittent connectivity, prepaid data bundles
where every megabyte is a deliberate purchase, and low-end Android hardware.
An app that shows a spinner when the network drops is not degraded — it is
useless, and it will be uninstalled.

This section also **closes an open question**: `ARCHITECTURE.md` §11.4 lists
*"Offline strategy depth — full offline-first sync (CRDTs, complex) vs basic
offline cache for reads only"* as unresolved. D9 resolves it.

### The shape: offline reads, online-only writes

**Every read is cacheable and renders from cache instantly. Every write
requires a live connection and fails loudly without one.**

This is not a compromise — it is the correct answer for this product, and
the argument is a money argument. Look at what the write surface actually
is: guardian payment initiation, and (Phase 8) assignment submission. That
is nearly all of it.

**A payment must never be queued offline.** `CLAUDE.md`'s Money hard rules
say the frontend never computes fees, discounts, or balances, and every
payment-mutating action goes through `FinanceService` with an audit row. A
queued offline payment would mean a parent tapping "Pay" on a phone with no
signal, the app cheerfully accepting it, and the actual Paystack transaction
happening minutes or hours later against a balance that may have changed —
with the parent believing since the tap that their child's fees are settled.
There is no acceptable UX for the failure case. Payments are a Paystack
redirect; a redirect needs a network; the honest thing is to say so.

Once payments are excluded, the remaining write volume does not justify a
sync engine. **We therefore build no mutation queue, no conflict resolution,
and no CRDTs** — and we avoid the entire class of bug where a cached write
silently diverges from server truth.

### Mechanism

TanStack Query (already the web standard per `CLAUDE.md`) with a persister
to device storage, hydrating the cache on cold start. Not a hand-rolled
SQLite layer: the query keys, staleness model, and revalidation logic are
identical to web, so the mental model transfers and the bespoke code is
close to zero (D10).

Behaviour per screen: **render cached data immediately, revalidate in
background, never block on the network.** A student opening the app in a
classroom with no signal sees their results — as of the last sync.

### Staleness must always be visible

**Never present stale data as live.** Every cached screen shows an explicit
"as of <time>" marker, and a clear offline indicator when the last refresh
failed (D11).

This matters most for money. A guardian seeing a zero balance that is
actually outstanding — or an outstanding balance they already paid — is a
money-adjacent correctness failure even though no write occurred. The fee
screen in particular should state its age prominently rather than
discreetly.

### Data cost is a design input

Prepaid bundles mean bytes are money to the user. Concretely:

- **No polling.** Ever.
- **No automatic background refetch on cellular** by default;
  `refetchOnWindowFocus: false` on metered connections.
- **Long cache TTLs on rarely-changing data** — student photos, school
  branding, class structure.
- **Small payloads.** This is a reason to prefer the existing narrow
  `/portal` endpoints over adding fat aggregate ones.

### PII at rest, and the shared-family-phone problem

The offline cache contains student names, results, and attendance — exactly
the PII `CLAUDE.md` requires be handled carefully. Two rules:

- **The cache is wiped completely on logout.** A shared family phone is the
  normal case, not the edge case; a second child logging in must not see the
  first child's cached results.
- **The session token lives in `expo-secure-store`, never in the query
  cache**, so cache persistence and credential storage stay separate
  concerns with different threat models.

### Expiry while offline

A session token expiring while the device is offline must **not** dump the
user to a login screen and discard their cached view. That is the worst
possible moment to destroy the only data they can still see. Correct
behaviour: keep showing cached data read-only, with a "sign in to refresh"
banner, and only clear on an explicit logout or a *successful* server
rejection.

---

## 8. API endpoints

**Guardian mobile: no new endpoints.** Reuses the eight `/portal` routes
listed in slice 2 unchanged (D14).

**Student portal: new, mirroring `/portal`'s narrowness.**

```
# Slice 3 — auth
POST /student-portal/login
POST /student-portal/activate          # guardian-initiated, see D6
GET  /student-portal/me

# Slice 4 — read surface
GET  /student-portal/me/results
GET  /student-portal/me/attendance
GET  /student-portal/me/fees

# Slice 5 — push
POST /devices                          # register an Expo push token
DELETE /devices/:id
```

Every `/student-portal/me/*` route resolves the student from the session and
never accepts a student ID from the client. There is no
`/student-portal/students/:id` — the shape makes the "can this student see
this row?" question unaskable rather than answering it correctly at six call
sites.

---

## 9. Decisions

All `[proposed]` pending review.

**D1 — Expo (React Native) confirmed; not re-litigated.** `ARCHITECTURE.md`
§5 records the choice with rationale ("share types with web; one codebase
for iOS and Android"), reinforced at §5 (Expo Push), §5 (Turborepo), and §4
(`apps/mobile` — Expo — parent and student app), plus a committed scaffold
and reserved bundle identifiers `ng.schoolkit.app`. Flutter would abandon the
shared `packages/types` Zod contract, the strongest argument in the recorded
rationale. **The platform question is closed; only version questions are
open.**

**D2 — Upgrade Expo SDK before writing screens.** Cheaper by a large factor
than after. Slice 1, not slice 6.

**D3 — Align mobile to React 19. [RESOLVED 2026-08-15 — spike run, React 19
adopted, no trade-off required.]**

The spike asked whether React 19 survives contact with the Expo SDK's peer
constraints, with the fallback being "keep mobile on React 18 and give up
`packages/ui` sharing". **That fallback is not needed.** Evidence, from
Expo's own version manifest (`api.expo.dev/v2/versions/latest`) rather than
from memory:

| SDK | expo | React Native | React |
|---|---|---|---|
| 52 | ~52.0.49 | 0.76.9 | 18.3.1 |
| 53 | ~53.0.27 | 0.79.6 | 19.0.0 |
| 54 | ~54.0.36 | 0.81.5 | 19.1.0 |
| 55 | ~55.0.28 | 0.83.10 | 19.2.0 |
| 56 | ~56.0.19 | 0.85.3 | 19.2.3 |
| 57 | ~57.0.13 | 0.86.2 | 19.2.3 |

React 19 is not merely *available* from SDK 53 — it is mandatory. SDK 52 is
the last SDK on React 18, so **D2 (upgrade the SDK) and D3 (adopt React 19)
turn out to be the same decision**, not two decisions with a dependency
between them. `react-native@0.79` peer-requires `react@^19.0.0`; there is no
supported configuration where a current Expo SDK runs React 18.

**Target: SDK 57 (latest), not the minimum SDK 53.** The reasoning is that
the app is empty. Slice 1 is the cheapest moment this upgrade will ever be —
five majors cost effectively nothing against 5 files and a great deal against
a built-out app. Deferring would mean paying more later for no benefit.

**A pre-existing divergence found and fixed along the way.** Mobile was
already type-checking React 18 runtime code against **React 19 type
definitions**: the root `pnpm.overrides` pinned `@types/react` to 19.0.12
globally, overriding mobile's own `~18.3.12` declaration, while
`react-native@0.76.5` peer-requires `@types/react@^18.2.6`. This had been
true since Phase 0 and was invisible because nothing typechecked hard enough
to expose it. The upgrade resolves it rather than papering over it; the root
override moved to 19.2.18 / 19.2.4, and repo-wide typecheck passes.

**Consequence: `packages/ui` sharing survives.** No trade to record, and
slice 2 inherits no constraint.

**D4 — Bearer-only auth (ADR-002), token in `expo-secure-store`.** No
cookies, no proxy route, no API transport change. Never `AsyncStorage`.

**D5 — Student login is school code + admission number + password.**
`Student.email` is nullable and non-unique and most students will not have
one; it cannot be the login key. `(school_id, admission_number)` already
carries a unique constraint, so this is single-row by construction and
avoids the guardian login's multi-row `argon2.verify` loop.

**D6 — Activation is guardian-mediated, not email-invited.** The guardian is
already authenticated in the portal and already linked via
`StudentGuardian`; they activate their child's account and set the initial
credential. Three reasons, the third decisive: it needs no student email
address; it adds no new delivery channel; and **it satisfies the NDPR
parental-consent requirement for a minor's account**, which emailing an
invitation link to a 12-year-old would not.

**D7 — Student credentials live on `Student`, not a separate account
table.** A student has exactly one account. A join buys nothing and adds a
nullable relation to every query.

**D8 — `StudentSession` mirrors `GuardianSession`, including no `school_id`
column.** Consistency with both existing session tables over saving a join.

**D9 — Offline: read-only cache. No offline writes, ever.** Resolves
`ARCHITECTURE.md` §11.4's open question. Full reasoning in §7 — the short
version is that the write surface is almost entirely payments, and a queued
payment has no acceptable failure UX.

**D10 — TanStack Query + persister, not a hand-rolled SQLite layer.** Same
query keys and staleness model as web; near-zero bespoke code.

**D11 — Staleness is always visible.** Every cached screen carries an "as of
<time>" marker. Silent stale data is a correctness failure, not a UX nit,
especially on the fee screen.

**D12 — Cache wiped on logout; token never in the query cache.** Shared
family phones are the normal case.

**D13 — Expo Push added as the preferred notification channel, with SMS
fallback.** Directly reduces recurring Termii spend. Does not remove SMS —
a parent without the app still needs it.

**D14 — Guardian mobile reuses the `/portal` API unchanged.** No new
endpoints, no versioning, no duplication. Confirmed against the four
`portal-*` NestJS modules.

**D15 — One app, two principals, not two apps.** `ARCHITECTURE.md` §4 already
says "parent and student app" (singular). A shared family device means one
install; the principal is chosen at login and drives routing. Two binaries
would double the store submissions, the release cadence, and the review
latency for no user benefit.

---

## 10. Hard rules — Phase 6 specifics

Extending `CLAUDE.md`'s rules to this phase's surfaces:

- **A student can only ever read their own rows.** Enforced at three layers:
  RLS, the session-resolved student ID, and an API shape that never accepts
  a student ID from the client (§8). Not one of the three — all three.
- **Never queue a money-mutating action offline.** See D9 and §7.
- **Never cache a session token in the query cache.** `expo-secure-store`
  only.
- **Never log a student's name, DOB, or admission number from the mobile
  client.** Mobile crash/analytics reporting is a new PII egress path that
  the API's redacting logger does not cover.
- **The offline cache is wiped on logout.** No exceptions for "convenience".

---

## 11. RBAC additions

A new `student` system role with a deliberately minimal permission set —
read own results, own attendance, own fees. Nothing else, and specifically
no `.read` on any collection-scoped resource. Named
`PHASE_6_STUDENT_PERMISSIONS` and spliced into `ALL_PERMISSIONS`, following
the convention `CLAUDE.md` established for the admin-dashboard initiative.

`permissions-coverage.spec.ts` gets a "student grants exactly the documented
Phase 6 subset" assertion, mirroring the teacher one.

---

## 12. Known gaps this phase carries

- **SECURITY DEFINER count 17 → 19**; shape review due at 20. Flagged, not
  resolved here.
- **Store review latency (1–3 weeks)** is outside the engineering estimate
  and outside your control.
- **`Student.photoUrl` upload is still open debt** (a string field, no upload
  UI) and student photos are the obvious thing a mobile app displays. Not in
  scope; will look conspicuous.
- **`ARCHITECTURE.md` §6.1 claims "Student account auto-created on
  enrollment"** — never built, never tracked, the same silent spec-vs-shipped
  substitution as the school-logo URL field. This phase closes it;
  `docs/deferred.md` should record the gap and its closure.
- **No isolated staging.** Slice 3's migrations run against the one database
  real schools use. Treat the RLS and SECURITY DEFINER correctness
  accordingly.
- **The render worker's wake is still broken**, and push notification
  delivery in slice 5 will want a worker.

---

## 13. Open questions for review

1. Slice order — is guardian mobile before student principal right? It is
   the cheapest proof the shell works, but it delays the phase's headline
   feature by ~a week.
2. Does D3 (React 19) survive contact with the chosen Expo SDK's peer
   constraints? Needs a spike in slice 1 before committing.
3. Should slice 5 (push) be cut to shorten the phase? It is the most
   separable slice and the only one with a direct revenue argument for
   keeping it.
4. Minimum supported Android version — this drives device testing scope and
   is genuinely a market question, not a technical one.
