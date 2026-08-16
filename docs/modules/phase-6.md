# Phase 6 — mobile app, student portal, guardian mobile

**Status:** approved 2026-08-15. Decisions D1–D15 are `[locked]`.
Slice 1 (mobile foundation) and slice 2 (guardian mobile) are built;
slices 3–6 not started.
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
| 3 — Student principal | Schema, `StudentSession`, 2 SECURITY DEFINER fns, guardian-mediated activation **and deactivation**, login, RLS, tests, §14.9 verification bar. No permissions — see D17. | 7–10d |
| 4 — Student mobile surface | Own results, attendance, fee status | 4–5d |
| 5 — Push notifications | Expo Push, device registration, wire to the existing `notifications` module | 4–5d |
| 6 — Store submission | Developer accounts, privacy labels, NDPR disclosures, build + submit | 3–5d eng |

**≈ 29–39 engineering days ≈ 6–8 weeks of pure build.** (Slice 3 moved
6–8 → 7–10 at its 2026-08-15 review: D25's deactivation action plus
§14.9's raised verification bar. See §14.10.)

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

**The API is already built.** Eight endpoints, all working in production:

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

**Delivered 2026-08-15.** D14 held: **not one API endpoint changed.** Two
controller header comments did, because they claimed the portal endpoints
were called only by `apps/portal`'s server-side proxy and `apps/mobile` is
now a second, direct caller — true to ADR-002, but the comments would
otherwise have become quietly false.

Three things the slice taught, each recorded where it happened rather than
smoothed over:

1. **`formatKobo` moved to `packages/types`.** Its own header asserted it was
   "the only place naira formatting lives in this codebase", and React Native
   cannot import from `apps/web`. Copying it would have made that sentence
   false on the day a second display layer appeared, so the function moved and
   `apps/web/src/lib/finance/format.ts` became a re-export — its ten import
   sites are untouched.
2. **The payment-status enum is `PENDING | SUCCESS | FAILED | REVERSED`.**
   The first cut of the poll loop invented `SUCCESSFUL`/`REFUNDED` and
   typecheck caught it. `TERMINAL` is now annotated `readonly PaymentStatus[]`
   so a future rename is a compile error rather than a loop that never exits.
3. **`experiments.typedRoutes` is now `false`** — see D16, added by this
   slice. Typed routes are generated only by the dev server into gitignored
   `.expo/`, which made them a gate that was stricter on one laptop than in
   CI, and stale enough to fail on routes that were correct.

The Paystack checkout does not deep-link back into the app (the callback URL
is a server-side constant pointing at the portal). Accepted for this slice
and logged in `docs/deferred.md`; it is cosmetic, because the outcome is
established by polling the API after the browser closes, never by the
redirect.

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

All **`[locked]` 2026-08-15**, approved as written. Where building against a
decision has since taught us something, that is recorded on the decision
itself rather than quietly amended.

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

**D16 — expo-router typed routes OFF; hrefs are plain strings.**
**[added and locked 2026-08-15, during slice 2 — not in the original plan.]**

`experiments.typedRoutes` was `true` from Phase 0, and `apps/mobile/
tsconfig.json` included `.expo/types/**/*.ts` to pick up the generated
declarations. That combination is a gate that behaves differently in three
places, which is worse than no gate:

- a developer who has run `expo start` typechecks against generated types;
- a developer who has not, typechecks without them;
- **CI never has them at all** — `.expo/` is gitignored, and `expo export`
  does not generate them. Only the dev server does.

It is also stale-prone, which is how it surfaced: slice 2's correct routes
failed local typecheck against a months-old `router.d.ts` that had somehow
captured paths from `apps/web`, on a commit CI would have passed. The
project has been bitten before by "passes locally, differently in CI" (see
`CLAUDE.md` on Vitest+SWC tolerating missing `dist/`), and the standing rule
there applies here: the gate must be the same everywhere.

Cost: a typo'd `href` is now a runtime 404 rather than a compile error. That
is accepted for a route table this small. Revisit if Expo ships a standalone
type-generation command that can run as a build step — at which point typed
routes become generateable in CI and the objection disappears.

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

> **SUPERSEDED 2026-08-15 by D17 (§14).** This section proposed a `student`
> system role with a `PHASE_6_STUDENT_PERMISSIONS` constant. Reading the
> guardian portal implementation before writing slice 3 showed that is wrong:
> guardians are a fully-shipped non-staff principal with **no role and no
> permissions at all**, and students should follow that precedent rather than
> the staff one. The original text is kept below, struck through, because the
> reasoning that replaced it is the useful part.

~~A new `student` system role with a deliberately minimal permission set —
read own results, own attendance, own fees. Nothing else, and specifically
no `.read` on any collection-scoped resource. Named
`PHASE_6_STUDENT_PERMISSIONS` and spliced into `ALL_PERMISSIONS`, following
the convention `CLAUDE.md` established for the admin-dashboard initiative.~~

~~`permissions-coverage.spec.ts` gets a "student grants exactly the documented
Phase 6 subset" assertion, mirroring the teacher one.~~

**Actual RBAC additions: none.** See D17.

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

---

## 14. Slice 3 plan-first — the student principal

**Status: plan-first, awaiting review. No code written.**
Written 2026-08-15, after reading the guardian portal's shipped
implementation end to end rather than working from the summary in §6.

This is the riskiest slice in the phase: it introduces a **third
authenticated principal** to a system that has two, adds two SECURITY
DEFINER functions, and touches FORCE-RLS tables — against a database with no
isolated staging tier. It gets the same treatment as the guardian-portal
auth build (phase-4.md §3/§4) and the platform-admin surface.

### 14.1 Verified starting state

Checked directly, not assumed:

| Fact | Evidence |
|---|---|
| `Student` has no auth columns | `schema.prisma` — no `passwordHash`, no session relation |
| No student principal anywhere | no `StudentSession`, no student guard, no student routes |
| `student` role is a documented placeholder | `phase-0.md:420` and `phase-1.md:1108` both say "TBD Phase 6" |
| `students` is under RLS already | `policies/phase-1.sql:104`, flat `school_id` policy |
| Guardians have **no role and no permissions** | `GuardianAuthGuard` resolves a session; services scope by `guardianId`. No entry in `permissions.ts`. |
| SECURITY DEFINER count is 17 | `security-definer-inventory.spec.ts` |
| `School.slug` is globally unique | `schema.prisma` — already public-facing (`<slug>.schoolkit.ng`) |
| `Student.status` exists | `ACTIVE / INACTIVE / WITHDRAWN / GRADUATED / SUSPENDED` |

---

### 14.2 The threat that shapes this whole slice

**A student's login identity is enumerable by construction, and the guardian
portal's is not.** This is the single most important difference between the
two builds, and every decision below is downstream of it.

Guardian login takes an email — a large, sparse, unguessable space. Student
login cannot: most students have no email address (`Student.email` is
nullable and non-unique, which is why D5 rejected it). The natural key is the
admission number, and admission numbers are **sequential and formatted**:
the dev seed's are `NJC/2025/001`, `NJC/2025/002`. Combined with a school
slug that is deliberately public (it is a subdomain), an attacker can
enumerate a school's entire student body with a script and a guess at the
format.

That does not make admission-number login wrong — there is no better
identifier available, and the alternative (per-student generated usernames)
trades an enumerable identifier for one children cannot remember. It means
the **credential** and the **rate limiting** have to carry weight that the
guardian flow could leave to the identifier's obscurity.

Mitigations, all of which are part of this slice rather than follow-ups:

1. **Unactivated students cannot log in at all.** `passwordHash IS NULL`
   until a guardian activates the account. On a school with 400 students and
   30 activated, enumeration finds 30 targets, not 400 — and the failure is
   identical for "no such student" and "not activated" (below).
2. **One generic failure for every cause.** Unknown school slug, unknown
   admission number, unactivated account, wrong password, non-`ACTIVE`
   status — all return the same `INVALID_CREDENTIALS`. The login path also
   performs a dummy argon2 verify when no candidate is found, so the
   zero-match and wrong-password cases take comparable time. This mirrors
   `AuthService`/`PortalAuthService`'s existing `dummyVerifyHash` pattern.
3. **Tighter throttling than either existing login.** Staff and guardian
   login both use `@Throttle({ default: { ttl: 60000, limit: 10 } })`.
   Student login gets **5/min per IP**, plus a per-`(schoolId,
   admissionNumber)` counter in Redis — the second is what an IP-rotating
   enumeration actually runs into. Redis is already provisioned and already
   used for rate limiting (`redis-auth.module.ts`).
4. **Lockout after repeated failures on one account** (proposed: 10 failures
   then 15 minutes), recorded so a school can see it. Deliberately a lockout,
   not a permanent disable: a locked-out child must not need an admin to get
   back into their homework.

**Explicitly accepted, not solved:** a guardian who activates a child's
account knows that child's initial password and can therefore sign in as
them. For a minor's account whose activation is deliberately parent-mediated
(D6), that is the correct trust model, not a flaw — but it is stated here so
nobody later mistakes it for an oversight.

---

### 14.3 Decisions

**D17 — A student is a principal with a session, NOT a role.
No permissions, no `ALL_PERMISSIONS` entry, no seed change. [proposed]**

This supersedes §11. The instinct was to mirror `teacher`; the correct
precedent is `guardian`. Guardians have shipped since Phase 4 as a fully
authenticated principal with **zero** presence in `permissions.ts` — no
role row, no grants, no `permissions-coverage.spec.ts` entry.
`GuardianAuthGuard` resolves the session and each service scopes results to
that guardian's own linked rows.

The staff RBAC machinery exists to answer "which of the many things in this
tenant may this staff member touch?". A student has exactly one answer —
their own rows — and encoding that as three permission strings would create
a grant that must be kept in sync while never varying. It is the same
reasoning the guardian-auth migration used for declining to widen
`Session.userId`: do not drag the staff permission model into a user class
that never needs it.

Consequence: `permissions.ts`, `system-roles.ts` and
`permissions-coverage.spec.ts` are all untouched by this slice. The
`student` "TBD Phase 6" placeholders in phase-0.md and phase-1.md get
resolved by **deleting the expectation**, with a note pointing here.

**D18 — Credentials live on `Student`; three columns, all nullable. [proposed]**

```
password_hash   TEXT          -- NULL until activated
activated_at    TIMESTAMP(3)  -- event moment
last_login_at   TIMESTAMP(3)  -- event moment
```

Directly mirrors Decision A of the guardian build, which added the same
shape to `guardians` rather than a companion table, on the same reasoning
(`User` already blends profile and auth in one row). All nullable, so there
is **no backfill**: every existing student is correctly represented as
"never activated, never logged in".

Deliberately **not** added: an `email_verified` equivalent. Guardians need
it because their identifier is an email. A student's identifier is their
admission number, issued by the school — there is no address to verify, and
a column that is always `false` invites someone to build a flow around it.

**D19 — `StudentSession` is a new table mirroring `GuardianSession`,
including no `school_id` column. [proposed]**

```
model StudentSession {
  id         String   @id @default(uuid())
  studentId  String   @map("student_id")
  tokenHash  String   @unique @map("token_hash")
  ipAddress  String?  @map("ip_address")
  userAgent  String?  @map("user_agent")
  expiresAt  DateTime @map("expires_at")
  createdAt  DateTime @default(now()) @map("created_at")
  student    Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  @@index([studentId])
  @@map("student_sessions")
}
```

RLS joins through `students.school_id`, the identical shape
`guardian_sessions` uses through `guardians`. Consistency with **both**
existing session tables beats saving one join, and a third session table
with a different tenancy shape would make the next reader wonder which is
correct.

Token handling is `createGuardianSession`'s exactly: 32 random bytes,
base64url, only the sha256 hash persisted, raw token returned once.
`STUDENT_SESSION_TTL_MS` = 30 days, matching both existing surfaces.

**D20 — Login identity is `School.slug` + `admissionNumber` + password. [proposed]**

`School.slug` is the "school code" D5 referred to abstractly. It is already
globally unique, already lowercase-normalised, already public (it is the
subdomain), and already has a reserved-word list. Nothing new is invented.

The decisive property is that `(school_id, admission_number)` carries a live
`@@unique` constraint, so **the lookup is single-row by construction**. This
is the one place slice 3 is structurally better than the guardian build: the
inventory's only multi-row function, `auth_lookup_guardians_for_login`,
exists because `Guardian.email` is unique only per school, forcing an
argon2-verify loop across candidate schools and an
`AMBIGUOUS_GUARDIAN_ACCOUNT` error for a guardian who did nothing wrong.
Students cannot reproduce that: slug resolves one school, and
`(school, admission)` resolves one student.

**Do not copy the guardian login service's verify-loop.** It is documented
as interim in its own migration header, and inheriting it here would be
copying a known-suboptimal shape into a surface that does not need it.

**D21 — Activation is guardian-mediated and needs NO new SECURITY DEFINER
function. [proposed]**

`POST /portal/students/:id/activate`, on the **existing** `/portal`
controller surface, behind the **existing** `GuardianAuthGuard`.

This is the structural payoff of doing guardian mobile first. The guardian
is already authenticated, so their session has already resolved a
`school_id` — the chicken-and-egg problem that forces SECURITY DEFINER
everywhere else in the auth layer simply does not arise. Activation is an
ordinary `withTenant` write, governed by RLS like any other tenant mutation.
The service re-checks the `StudentGuardian` link inside the transaction; a
guardian may only activate a child actually linked to them.

Body: `{ password: string }`. Re-activation of an already-activated student
is a **password reset**, allowed (a child forgetting their password is the
common case and must not need school staff), audited distinctly from first
activation, and it **revokes every existing `student_sessions` row** for
that student.

**D22 — Exactly two new SECURITY DEFINER functions. Count 17 to 19. [proposed]**

Both follow the narrow-single-caller discipline the Slice 12 audit settled
on, and both get a migration header covering why SD is needed, what is
returned, and what is deliberately withheld.

| Function | Returns | Deliberately omits |
|---|---|---|
| `auth_resolve_student_session(token_hash)` | `session_id, student_id, school_id, expires_at, student_status, portal_enabled` | `password_hash` **itself** — `portal_enabled` is the boolean `password_hash IS NOT NULL`, never the hash. Also names, DOB, photo, address, phone, email, medical notes, `notes` — the guard runs pre-tenant and its result is attached to the request, where PII does not belong |
| `auth_lookup_student_for_login(school_slug, admission_number)` | `student_id, school_id, password_hash, status` | everything else on a PII-dense row. Deliberately separate from the session resolver, which must never see `password_hash` — the same split `auth_lookup_user_for_password_reset` made from `auth_lookup_user_for_login` |

`RETURNS TABLE`, `LANGUAGE sql`, `SECURITY DEFINER`,
`SET search_path = public, pg_temp`, `REVOKE ALL FROM PUBLIC`,
`GRANT EXECUTE TO app_user`. Both are added to
`SECURITY_DEFINER_FUNCTIONS` in the conformance spec and to CLAUDE.md's
inventory table **in the same PR**, which is what that spec exists to force.

**The cadence review is due at 20; this lands at 19.** Flagged now, in
writing, for the fifth time in this table's history — because the previous
four flags were each written by someone who also did not do it.

**D23 — The session resolver returns `status`, and the guard rejects a
student who is not `ACTIVE`. [proposed]**

This closes, for students, the gap the guardian build explicitly flagged and
left open. `auth_resolve_guardian_session`'s header records that `Guardian`
has no `is_active` equivalent, so the only way to revoke portal access is
clearing `password_hash`.

`Student` already has `status`. A student who is `WITHDRAWN`, `GRADUATED`,
`SUSPENDED` or `INACTIVE` must stop being able to sign in **and** must have
live sessions rejected — a student expelled on Tuesday should not still be
reading the portal on Wednesday because their 30-day token is valid. Doing
the check in the guard (re-read every request, from the SD function's own
return) rather than only at login is what makes revocation immediate.

This mirrors `AuthGuard`'s `user_is_active` check, which is the precedent —
and it means the student surface ships with a revocation story the guardian
surface still lacks.

**Amended 2026-08-15 (see D25):** the resolver also returns `portal_enabled`
(`password_hash IS NOT NULL`), and the guard rejects on **either** a
non-`ACTIVE` status **or** `portal_enabled = false`. The two checks answer
different questions and neither subsumes the other:

- `status` is the **school's** judgement about enrolment — set by staff.
- `portal_enabled` is the **guardian's** judgement about this child holding
  credentials — set by a parent, and untouched by enrolment.

A guardian deactivating their child does not, and must not, change the
child's enrolment status. Without the second check, deactivation would rely
entirely on `DELETE FROM student_sessions` having succeeded; with it, a
surviving session row is still refused on the next request. Deactivation is
therefore authoritative at the point of *authority* rather than at the point
of *cleanup* — the same "re-read the truth every request" principle that
makes the status check worth having at all.

**D25 — A guardian-facing "turn off my child's account" action ships in THIS
slice, not a later one. [proposed 2026-08-15, added at review]**

**Requirement, as given:** credentials must not be activated in a slice that
ships no way to turn them back off. Revocation was described in the original
draft as a property of the guard; it was not an action any human could take.
That gap is closed here.

`POST /portal/students/:id/deactivate` — existing `/portal` surface, existing
`GuardianAuthGuard`, same `StudentGuardian` link re-check inside the
transaction as activation. Manually triggered by a guardian; nothing about it
is automated, and it deliberately does not need to be.

In one transaction it:

1. sets `password_hash = NULL` — the login lookup requires a non-null hash,
   so no future sign-in can succeed;
2. `DELETE`s every `student_sessions` row for that student — existing
   sessions die immediately rather than at their 30-day expiry;
3. writes a `student.deactivate` audit row with the acting `guardianId`.

`activated_at` is deliberately **left set**. It records that this child was
once activated, which is history, not current state.

**No new column.** Portal state is derived, and the three states are exactly
distinguishable from the two columns already proposed in D18:

| State | `activated_at` | `password_hash` |
|---|---|---|
| Never activated | NULL | NULL |
| Active | set | set |
| Deactivated by a guardian | set | NULL |

*When* deactivation happened lives in `audit_logs`, which is the system of
record for that question. A `deactivated_at` column would be a second,
divergeable copy of something already written down.

**Reactivation is just activation again.** D21 already specifies that
activating an already-activated student is a password reset that revokes
sessions; the same endpoint and the same code path bring a deactivated child
back, with a fresh password the guardian sets. There is no separate
"reactivate" verb, and therefore no state machine to get wrong.

**Who may deactivate: any linked guardian**, matching the activation proposal
in §14.10 Q4. Asymmetry here would be worse than the risk it prevents —
requiring `isPrimary` to switch access *off* means the parent holding the
phone at 10pm cannot act on a device they believe is compromised.

**Deliberately NOT in scope**, and the boundary is worth stating precisely
because "deactivation" is doing two jobs in ordinary speech:

- **School-initiated** deactivation. Staff already have `Student.status`, and
  D23's guard check honours it immediately. A school does not need this
  endpoint.
- **Automated lifecycle handling** — withdrawal, promotion between sessions,
  graduation cascading to portal access. Deferred (see the amended §14.10),
  and deferred now means *only* the automation: the manual guardian action
  above is real, shipped, and testable in this slice.

Cost: roughly half a day of the estimate, most of it tests rather than the
endpoint.

**D26 — Activation is a single-use INVITATION TOKEN issued by a guardian, not
a password the guardian types. Deactivation burns the token.
[approved 2026-08-15 at review — SUPERSEDES the activation half of D21, the
"reactivation is just activation again" clause of D25, and D24's placement]**

The earlier design had a guardian POST a password directly for their child.
That is rejected, and the reasoning is worth keeping because it generalises:

> A session-only "off" switch that a trivial re-scan defeats is a **false
> safety control — worse than none at all**, because it tells a parent they
> have revoked access when they have not.

Under the old design, deactivation nulled `password_hash` and deleted
sessions. But if the child still held anything reusable — a link, a code, a
screenshot of one — the control was theatre. The fix is to make the thing
the child holds **single-use**, and to make deactivation **burn it**.

**The flow.**

1. Guardian, on their child's detail page, taps *Invite to School Kit*.
   `POST /portal/students/:id/portal-invitation` mints a token, returns the
   raw value **once**, and stores only its sha256 hash.
2. The child opens the link, and sets their own password on the accept page.
   This mirrors the guardian's own accept flow exactly, which is the closest
   precedent in the codebase (`/invitations/[token]`).
3. Accepting **consumes** the token: `accepted_at` is stamped, and the
   resolver will never return it again. A forwarded screenshot of an
   already-used link is worth nothing — this is the specific scenario the
   design is against, and it is common: parents forward things.
4. Thereafter the child signs in with school slug + admission number +
   password (D20 unchanged).

**Deactivation (`POST /portal/students/:id/deactivate`) does three things in
one transaction, and the third is the one this decision adds:**

1. `password_hash = NULL` — no future sign-in;
2. `DELETE` every `student_sessions` row — live sessions die on the next
   request;
3. `revoked_at = now()` on **every** outstanding un-accepted invitation for
   that student — so nothing the child, or anyone they forwarded it to,
   still holds can be replayed.

**Reactivation is therefore NOT "activate again".** D25 said re-activation
was the same endpoint with a new password; that is now wrong. A deactivated
child comes back only when a guardian **deliberately issues a fresh
invitation**. There is no path from "off" to "on" that does not pass through
an explicit act by a parent — which is the entire point of the control.

**Token properties.** 32 random bytes, base64url, sha256-hashed at rest,
raw value returned exactly once (identical to session tokens and guardian
invitations). Expiry 7 days — deliberately shorter than the guardian
invitation's, because a child's link is more likely to sit unread in a
family chat. Issuing a new invitation revokes any previous outstanding one,
so at most one live token exists per student at any moment.

**Consequence: a THIRD SECURITY DEFINER function, and the count lands on 20.**
The child opening the invitation link has no session and no school context,
so resolving the token is a pre-tenant read against a FORCE-RLS table — the
same chicken-and-egg every other invitation lookup in this codebase has.
`auth_resolve_student_invitation(token_hash)` is unavoidable. Count moves
**17 → 20**, not 17 → 19.

That is not a footnote: **20 is exactly the cadence-review trigger** CLAUDE.md
set after the last review ("Next review due at 20"). It is due with this
migration, not after it. See §14.13.

**What D24 still governs**: the password policy (min 8, no composition rules,
no PIN) is unchanged — it simply moves from the guardian's activation call to
the child's accept call, which is where the password is now chosen. The login
DTO stays lenient for the same anti-probing reason.

**D27 — Authorization is an explicit link check that RAISES, before and
separate from the write. Never inferred from rowCount.
[approved 2026-08-16 at review — added after a live finding]**

Established by testing the naive implementation against real RLS **before
any service code existed**. Two facts, both measured as `app_user` with a
valid school GUC — i.e. exactly a guardian's request context:

**1. RLS does not protect one family from another.** A guardian not linked
to a child in the *same school* can still see that child, and a plain
`UPDATE students SET password_hash = NULL WHERE id = <other family's child>`
**succeeds** (`UPDATE 1`). Every tenant boundary is satisfied; tenancy was
never the boundary in question. The only thing that can stop this is a
service-layer check.

**2. The obvious "safe" fix hides an ambiguity.** Scoping the write by the
link — `UPDATE ... WHERE id = ? AND EXISTS (link)` — yields:

| Case | rowCount |
|---|---|
| Linked child, already deactivated | **1** |
| Not linked (another family) | **0** |
| Student does not exist | **0** |

Worth recording precisely, because the first line disproves the obvious
worry: already-deactivated returns **1**, not 0, since `UPDATE` counts rows
*matched*, not rows *changed*. So rowCount does **not** conflate
"unauthorized" with "already off".

What it *does* conflate is **unauthorized** with **not found** — which must
become **403** and **404**. Those are different answers to different
questions, and a service that branches on `rowCount === 0` cannot tell them
apart. It would either 404 a real authorization failure (leaking nothing, but
misreporting) or 403 a typo'd id (leaking that the id is absent).

**Therefore:**

```
1. Re-fetch the StudentGuardian link for (guardianId, studentId).
2. No student row at all            -> NotFoundError    (404)
3. Student exists, no link          -> ForbiddenError   (403)
4. Only then perform the write, unscoped by the link.
```

The check **raises**, and it happens **before** the write and **separately**
from it. The write is not defensively re-scoped, because a write whose safety
depends on its own `WHERE` clause is a write whose safety cannot be asserted
independently — and step 3 is the assertion. Both live in the same
transaction, so the check cannot go stale between check and write.

This applies to **every** guardian action on a child — `portal-invitation`,
`deactivate`, `portal-status` — not just deactivation. It is the same shape
`PortalStudentsService` already uses for reads; this decision makes it
explicit and testable for writes, and gives the negative-walk suite a
specific thing to assert rather than "returns an error".

**D24 — Password policy: minimum 8 characters, no composition rules, no
PIN. [proposed]**

A 4- or 6-digit PIN is tempting for a JSS1 student and is exactly wrong
given §14.2: a numeric PIN over an enumerable username space is
brute-forceable regardless of rate limiting. Eight characters minimum, no
forced mixed-case/symbol rules (they produce `Password1!`, not entropy),
reusing `packages/types`' existing password schema rather than inventing a
second policy.

The login DTO stays deliberately lenient (`min(1)`), matching
`guardianLoginSchema`'s documented reasoning: validating policy at login
would let an attacker probe compliance via 400-vs-401. Policy is enforced at
**activation**, where it belongs.

---

### 14.4 API surface

```
# Public
POST   /student-portal/login          { schoolSlug, admissionNumber, password }
POST   /student-portal/logout         (session-authenticated; deletes the row)

# Session-authenticated (StudentAuthGuard)
GET    /student-portal/me

# Guardian-authenticated (GuardianAuthGuard, existing /portal surface)
POST   /portal/students/:id/activate    { password }   # also re-activates
POST   /portal/students/:id/deactivate                 # D25
GET    /portal/students/:id/portal-status
```

`GET /portal/students/:id/portal-status` returns
`{ state: "NEVER_ACTIVATED" | "ACTIVE" | "DEACTIVATED", activatedAt }` —
derived from the two columns per D25's table, not stored. It is what makes
the guardian-facing control renderable, so it ships with the two writes
rather than after them.

`GET /student-portal/me` returns `{ student: { id, firstName, lastName,
admissionNumber, currentEnrollment }, school: { id, name, slug } }` —
mirroring `GuardianLoginResponse`'s shape and, like it, excluding DOB,
address, phone, medical notes and `notes`.

**Slice 3 ships no data-reading routes.** Results, attendance and fees are
slice 4. Slice 3's job is the principal, and stopping there keeps the
reviewable surface to auth alone.

There is deliberately **no** `/student-portal/students/:id`. Every future
student route hangs off `/me`, so "can this student see this row?" is a
question the URL shape makes unaskable rather than one answered correctly at
six call sites.

---

### 14.5 RLS

```sql
ALTER TABLE student_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON student_sessions
  USING (EXISTS (
    SELECT 1 FROM students
    WHERE students.id = student_sessions.student_id
      AND students.school_id::text = current_setting('app.current_school_id', true)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM students
    WHERE students.id = student_sessions.student_id
      AND students.school_id::text = current_setting('app.current_school_id', true)
  ));
```

Byte-for-byte the `guardian_sessions` policy with the join retargeted.
`students` and `student_guardians` already have policies and are unchanged.

---

### 14.6 Audit

Every action gets an `audit_logs` row inside the same transaction as the
write, following `guardian.login`'s established pattern (`userId` carries
the acting principal's id — the column has no FK constraint, and "who did
this" is the intent):

| Action | `userId` | Notes |
|---|---|---|
| `student.login` | studentId | metadata: admission number, user agent. **Never the password.** |
| `student.login-failed` | null | school + admission number, so a school can see enumeration against their roster |
| `student.activate` | guardianId | the guardian is the actor, not the student |
| `student.reactivate` | guardianId | distinct from first activation — it is a password reset and invalidates sessions |
| `student.deactivate` | guardianId | D25. Metadata records how many sessions were revoked, so "did it actually take effect?" is answerable after the fact rather than inferred |
| `student.logout` | studentId | |

`student.login-failed` is a deliberate addition beyond what staff and
guardian login record. It exists because §14.2's enumeration risk is only
detectable if failures are written down.

---

### 14.7 Test plan

Unit and integration, mirroring `portal-auth.service.spec.ts` and
`portal-payments.controller.spec.ts`:

- login: happy path; wrong password; unknown slug; unknown admission number;
  **unactivated student**; each non-`ACTIVE` status — all asserting the
  *identical* error body, since a divergent message is the enumeration leak
- lookup is single-row: two schools, same admission number, correct student
- guard: valid, expired, unknown, malformed, missing `Bearer`; and a student
  whose status changes to `WITHDRAWN` **after** a session exists (D23)
- activation: happy path; guardian not linked to the student (must 403);
  re-activation revokes existing sessions; password below policy rejected
- **deactivation (D25)**: a live session stops working on the *next* request;
  a subsequent login attempt with the correct old password fails with the
  same generic `INVALID_CREDENTIALS`; `portal-status` reports `DEACTIVATED`;
  re-activation restores access with a new password; deactivating an already
  deactivated student is idempotent, not an error; a guardian not linked to
  the child gets 403
- **deactivation is authoritative even if cleanup fails**: with the session
  row left in place artificially, the guard must still refuse on
  `portal_enabled = false`. This is the check that makes D25 a revocation
  rather than a best-effort delete, so it is tested directly rather than
  assumed from the two mechanisms individually
- isolation: a session for school A never resolves rows in school B
- RLS: `student_sessions` with no GUC returns 0 rows; cross-tenant INSERT
  rejected by `WITH CHECK` — exercised as `app_user`, the pattern the
  Paystack migration used
- `security-definer-inventory.spec.ts` passes at 19 with both new functions
  owned by `school_kit`, `search_path` pinned, PUBLIC revoked

Plus the same **live round-trip** slice 2 just received, since that is now
the standard: real login against a running API, real activation by a real
guardian session, and a real rejection after a status change.

---

### 14.8 Migration and rollout safety

`CLAUDE.md` is explicit that **there is no isolated staging** — every
"staging" deploy runs against the one database real schools use, and
`deploy-staging.yml`'s auto-rollback reverts the Fly release, not a
migration that already ran.

Properties that make this migration safe to run against live data:

- **Additive only.** Three nullable columns and one new table. No column is
  dropped, renamed or retyped; no existing row is rewritten.
- **No backfill.** Nullable columns mean existing students are already
  correctly represented.
- **No behaviour change for anyone currently using the product.** No
  existing endpoint, guard or policy is modified. Until a guardian activates
  a child, the feature is inert.
- **The unique index already exists.** `(school_id, admission_number)` is
  from Phase 1; this slice adds no new constraint that could fail on live
  data.

Verification against a live database after applying, matching the standard
the Paystack migration set: confirm both functions are `prosecdef`, owned by
`school_kit`, `search_path` pinned, EXECUTE granted to `app_user` with
PUBLIC absent, `count(*) WHERE prosecdef` returning exactly **19**, and the
RLS boundary exercised as `app_user`.

---

### 14.9 Verification bar — set at review, 2026-08-15

This is the first surface in the project protecting **a child's own access,
mediated by revocable parental trust**. The bar is therefore at least the
platform-admin build's, and the three requirements below are gates on merge,
not aspirations.

**1. Negative-walk tests, cross-tenant and cross-family.** Structural tests
prove the happy path is wired; a negative walk proves the wrong answer is
actually refused. Every one of these is a written test, not a review
comment:

| Walk | Must produce |
|---|---|
| Student A's session used against student B's `/me` in the **same family** (siblings, one guardian) | B's data never returned — `/me` resolves from the session, so the attempt is unrepresentable, and the test asserts that rather than trusting the URL shape |
| Student A's session, student B in the **same school**, different family | refused |
| Student A's session, student B in a **different school** | refused; and the SD resolver returns no cross-tenant row |
| Guardian G acting on a child they are **not** linked to (same school, different family) | **403, not 404 and not a 200 with a 0-row no-op** (D27). RLS permits this write — only the service check stops it. |
| Guardian G acting on a student id that does not exist | **404**, distinguishable from the 403 above even though the naive rowCount for both is 0 |
| Guardian G in school X acting on a student in school Y | 403, and no row read |
| A deactivated student's surviving session (row left in place) | refused on `portal_enabled` |
| A `WITHDRAWN` student's live session | refused on `status` |
| `student_sessions` read as `app_user` with **no** GUC | 0 rows |
| `student_sessions` cross-tenant INSERT as `app_user` | rejected by `WITH CHECK` |

The sibling case is called out separately because it is the one an
implementation is most likely to get wrong while looking correct: two
students, one guardian, one school, one family — every tenant boundary
satisfied, and the only thing standing between them is that `/me` resolves
the student from the session and never from a path parameter.

**2. The two SECURITY DEFINER functions are reviewed line by line, by the
project owner, before merge.** Not "the migration passed CI" and not "the
inventory spec is green" — a direct read of both function bodies, their
`REVOKE`/`GRANT` lines, and their headers. The conformance spec checks
*shape*; it cannot check whether the `WHERE` clause is right. The PR will
present both functions in full in its description so the review does not
require hunting through a migration file.

**3. A genuine end-to-end manual walkthrough before ship**, in the same
style as slice 2's live verification, exercising the full trust cycle on
real data:

```
guardian signs in → activates child → child signs in with the new password
→ child reads /me → guardian deactivates → child's live session dies on the
next request → child cannot sign in again with the old password
→ guardian re-activates with a new password → child signs in again
```

Structural tests can pass with all of that broken in ways only a human
notices — the header-styling bug in slice 2 passed 57 unit tests, a clean
typecheck and 11 browser assertions. The walkthrough is the step that
catches the equivalent here.

---

### 14.10 Estimate

§2 budgeted 6–8 engineering days. **Unchanged, with the range's shape
revised**: D21 removes an expected SECURITY DEFINER function and an entire
invitation/token/delivery flow (the guardian build needed
`guardian_invitations`, a token table, an email, and an accept endpoint —
none of which exist here, because the activating party is already
authenticated). Against that, §14.2's rate-limiting, lockout and
failed-login auditing are real work the original estimate did not name.

Net: still 6–8 days, but more of it is now security hardening and less is
plumbing — which is the better distribution for the riskiest slice, and
worth saying out loud so the number is not mistaken for a coincidence.

**Revised at review, 2026-08-15: 7–10 engineering days.** Two additions, and
the second is the larger of the two by some margin:

- **D25 (deactivation)** — about half a day. The endpoint is small; the
  tests are most of it.
- **§14.9's verification bar** — 1–2 days. Nine negative-walk tests, a PR
  written to present both SECURITY DEFINER function bodies in full for
  line-by-line review, and a scripted end-to-end manual walkthrough of the
  activate → sign in → deactivate → re-activate cycle. This is deliberately
  *not* absorbed into the existing range: pretending a raised evidence bar
  is free is how a bar quietly stops being met.

---

### 14.11 Explicitly deferred, with the boundary stated

**Automated lifecycle handling — deferred.** Withdrawal, promotion between
academic sessions, and graduation do not automatically propagate to portal
credentials. A `WITHDRAWN` or `GRADUATED` student is already refused by
D23's guard check on every request, so the *access* consequence is immediate
and correct; what is deferred is the housekeeping — no job clears
`password_hash`, deletes stale `student_sessions` rows, or notifies anyone.

The boundary matters because "deactivation" means two different things in
ordinary speech, and only one of them is deferred:

| | Status |
|---|---|
| Guardian manually turns their child's account off | **Shipped in this slice** (D25) |
| School turns a student's enrolment off | **Already works** — `Student.status` + D23 |
| Automated propagation and cleanup on lifecycle events | **Deferred** |

**Tutor-specific session scoping — deferred, and confirmed not precluded.**
Phase 7's tutor may later want a session scope (a token that may reach the
tutor but not, say, results). Confirming explicitly, as asked, that nothing
in D19's design blocks that: `student_sessions` is an opaque-token table
whose rows are resolved by a single SD function returning a fixed column
set. Adding a `scope` column later is an additive migration with a
backfillable default (`'full'`), one added field in the resolver's
`RETURNS TABLE`, and one check in the guard. No table would need splitting,
no token reissued, and no existing session invalidated. This is a
confirmation, not a design — the scope taxonomy itself stays a Phase 7
decision.

---

### 14.12 Open questions for review

1. **Lockout threshold and duration** — proposed 10 failures / 15 minutes.
   Genuinely a product call: too aggressive and a class of children locks
   itself out before an exam.
2. **Should `student.login-failed` audit rows be capped or sampled?** A
   sustained enumeration attempt would write one row per attempt into a
   partitioned table. Rate-limiting rejects most of them before the service
   runs, but the interaction is worth a decision rather than a discovery.
3. **Does a `SUSPENDED` student keep read access?** D23 proposes no. There
   is a real argument the opposite way — a suspended child arguably needs
   their work more, not less — and it is a school-policy question, not a
   technical one.
4. **Should activation be available to any linked guardian, or only
   `isPrimary`?** Proposed: any linked guardian, because requiring the
   primary blocks the parent who actually has the phone.

---

### 14.13 Recommended defaults for §14.12 — resolved 2026-08-16

Written after building the surface, so these supersede the guesses in
§14.12. **Two of the four reverse what that section proposed**, and both
reversals come from the same place: the threat model looks different once the
enumerable username space is real code rather than a paragraph.

**Q1 — Lockout threshold. RECOMMENDATION: no account lockout at all.
Per-`(school, admission)` throttling with escalating delay instead.
[reverses §14.12's "10 failures / 15 minutes"]**

Account lockout over an enumerable username space is a **denial-of-service
handed to the attacker**. Admission numbers are sequential and school slugs
are public; a script that can enumerate a roster can equally well lock every
account in it. Ten deliberate failures per student, at 400 students, is a few
thousand requests — a school's entire cohort locked out on the morning of an
exam, by design, using the security control as the weapon.

Instead: keep the 5/min per-IP throttle already shipped, and add a Redis
counter keyed on `(schoolId, admissionNumber)` that **slows** rather than
blocks — after 10 failures in 15 minutes, that pair is limited to roughly one
attempt per minute for the next 15. A child retrying their own password gets
in on the next try; an attacker's throughput collapses by two orders of
magnitude; nobody is ever locked out of their own account by someone else's
behaviour. The counter keys on the pair, not the IP, because IP rotation is
the cheap part of this attack.

**Q2 — Cap or sample `student.login-failed` rows? RECOMMENDATION: no. Keep
1:1, and revisit only on evidence.**

The concern assumed unbounded volume, and it is already bounded by the layer
in front: throttled requests are rejected before the service runs, so they
write nothing. With 5/min per IP the worst case is ~300 rows/hour/IP, into a
table that is already monthly-partitioned. Sampling would trade a real
capability — a school seeing that its roster is being walked — against a cost
that has not been demonstrated. Revisit if a real incident produces real
volume; do not pre-optimise the monitoring away before it has ever been used.

**Q3 — Does a `SUSPENDED` student keep read access? RECOMMENDATION: YES.
[reverses §14.12's proposed "no"]**

Suspension is a **behavioural** sanction and is usually temporary. Cutting
portal access converts it into an **academic** one — the suspended child, who
is already missing lessons, also loses the results, timetable and fee
information that would help them keep up. No school intends that when it
suspends a pupil for a fortnight, and a system that quietly imposes it is
making a disciplinary decision the school did not make.

The other non-`ACTIVE` statuses should still lose access, and for a reason
that separates them cleanly: `WITHDRAWN` and `GRADUATED` mean the child has
**left the school**, and `INACTIVE` is an administrative hold. Those are
"no longer our pupil"; `SUSPENDED` is "our pupil, currently in trouble".

**This is a code change that has NOT been made.** `PORTAL_ALLOWED_STATUS` is
currently the single value `ACTIVE`, in both `StudentAuthGuard` and
`StudentPortalService.login`, so as shipped a suspended child IS locked out.
It is a two-line change to a set plus test updates, and it is a product call,
so it is proposed here rather than assumed.

**Q4 — Any linked guardian, or only `isPrimary`? RECOMMENDATION: any linked
guardian. [confirms §14.12]**

Requiring `isPrimary` to switch access **off** is the wrong asymmetry: the
parent holding the phone at 10pm, on a device they believe is compromised,
must be able to act. Restricting the destructive direction is protection
aimed at the wrong risk.

The residual concern — one parent in a separated family switching off a child
the other parent set up — is real but is not solved by `isPrimary` either
(the primary is whoever the school recorded first, not whoever is right). It
is addressed by the audit trail: every issue and every deactivation records
**which** guardian acted, so a dispute is answerable after the fact. That is
already implemented and tested.

---

## 15. Slice 4 plan-first — the student mobile surface

Written 2026-08-16, after slices 1–3 shipped (PR #181) and the status
asymmetry was corrected (PR #183).

### 15.1 Two findings that change this slice before it starts

The framing handed to this plan was: *student results must mirror the exact
same gate already governing guardian visibility — nothing shown to the
student earlier than what has been released for the guardian. Timetable is
fine as a first, ungated surface.*

The constraint is right and this plan adopts it in full. But both of its
premises turn out to be false about the current codebase, and each one is
load-bearing.

**Finding 1 — there is no guardian results surface to mirror.** The guardian
portal exposes exactly three domains: `portal-students`, `portal-finance`
(invoices), `portal-payments`. There is no report-card or assessment
endpoint anywhere behind `GuardianAuthGuard`. Verified by reading every
route in `portal-students.controller.ts` and grepping both portal modules
for `reportCard`/`assessment` — no hits.

So "mirror the guardian gate" cannot be implemented as "call the same
endpoint the guardian calls". **There is no such endpoint.** A parent today
cannot see their child's results in School Kit at all.

What *does* exist is the gate itself, and it is a good one:
`ReportCardStatus` runs `DRAFT` → `SUBJECT_REVIEWED` → `FORM_REVIEWED` →
`PRINCIPAL_APPROVED` → `RELEASED`, with `releasedAt` stamped at the final
transition, a release endpoint restricted to owner/admin, and a
`released-guard.ts` that freezes a released card. `RELEASED` is documented
in the schema as literally "parent-visible". The gate is real, tested, and
already the school's own definition of "ready to be seen". It has simply
never had a reader attached to it.

The constraint therefore restates as: **`RELEASED` is the gate, and the
student and the guardian must read through one shared server-side helper —
not two endpoints that happen to filter the same way today.** That is a
stronger guarantee than mirroring an endpoint would have given, because it
cannot drift.

**Finding 2 — there is no timetable.** No `Timetable`, `Period`,
`Schedule`, or `Lesson` model; no `dayOfWeek`, no `startTime` anywhere in
`schema.prisma`. `LessonPlan` is content authoring (topic, objectives,
generated sections) with no scheduling fields at all.

"Timetable is fine as a first, ungated surface" assumes a timetable exists
to render. Building one is not a screen — it is a feature: a period grid per
class arm, day/time slots, subject-and-teacher assignment per slot, an admin
authoring UI, and term-boundary behaviour. That is comparable in size to
everything in slices 1–3 combined, and none of it is mobile work.

### 15.2 What this means for scope — recommendation

Slice 4 as conceived was "the easy ungated screen plus the hard gated one".
In fact the ungated screen is the expensive one and the gated screen is
nearly free, because its gate is already built and only needs a reader.

**Recommended scope — build the results surface, drop the timetable.**

| In | Out |
|---|---|
| Shared `RELEASED`-gated results reader | Timetable data model |
| `GET /student-portal/results` (term list) | Timetable authoring UI |
| `GET /student-portal/results/:termId` (one card) | Timetable screen |
| `GET /portal/students/:id/results` — the guardian half, same helper | Report-card PDF download (see D31) |
| Student mobile: results list + detail | |
| Offline cache for both | |

Two reasons to prefer this over building the timetable first:

1. **Results are the reason a family opens the app.** A parent who cannot
   see results in School Kit is the gap most visible to a paying customer,
   and it exists today for guardians as much as students.
2. **It closes an asymmetry that would otherwise ship.** Building the
   student results screen alone would give a child access their own parent
   does not have — which is the precise inversion of the supervision model
   slice 3 was built on. The guardian half is not scope creep here; it is
   what keeps the constraint coherent.

If the timetable is wanted, it should be its own slice with its own
plan-first, and it is genuinely a Phase-2-shaped feature (academic
structure) that arrived late rather than a mobile one.

### 15.3 Decisions

**D28 — `RELEASED` is the only gate, and it is read in ONE place.**
A single `loadReleasedReportCards(db, studentId, opts)` helper in a shared
service, called by both the student and guardian controllers. Neither
controller may query `report_cards` directly. The status filter is
`status === "RELEASED"`, never `releasedAt !== null` — those are the same
today, but the first is the school's decision and the second is a timestamp
that a backfill or a data fix could set independently.

Rationale: the constraint is "nothing shown to the student earlier than the
guardian". Two endpoints filtering identically satisfy that on the day they
are written and stop satisfying it the first time one is edited. One helper
makes it structural — the same instinct as the cadence review's refusal to
merge the session resolvers: put the guarantee where it cannot be forgotten.

**D29 — the guardian results endpoint ships in this slice.**
`GET /portal/students/:id/results`, behind `GuardianAuthGuard`, reusing
`assertLinked` from `student-access.service.ts` so cross-family reads get
the same 404-then-403 treatment D27 established for writes. Without this,
slice 4 gives a child something their parent cannot see.

**D30 — no separate "student results" DTO shape.**
One `ReportCardSummaryDto` / `ReportCardDetailDto` in
`packages/types/src/report-cards/`, used by both principals. If the two
audiences ever need different fields, that is a deliberate later decision
with a named reason, not an accident of two people writing two DTOs.

**D31 — the PDF is out of scope for this slice.**
`artifactUrl` points at R2 and rendering runs through the render worker,
which `docs/deferred.md` records as having a broken wake path. Serving a PDF
to a student would need a presigned-URL flow (the `getExpenseReceiptUrl` /
school-logo pattern), a decision about TTL for a document a child may want
to keep, and a working render worker. The structured card renders natively
on mobile without any of that. Flagged, not built.

**D32 — results are cached offline; they are the best possible cache
candidate.** A released report card is immutable by `released-guard.ts`, so
the usual staleness objection does not apply: a cached released card cannot
be wrong, only absent. Cache with a long TTL and no background refetch on
the detail screen. This is the first surface in the app where the offline
layer from slice 2 earns its place rather than merely existing.

**D33 — an empty results list is a first-class state, not an error.**
Most students will have nothing released for most of the year. The screen
says so plainly ("Nothing has been released yet") rather than showing a
spinner, an empty table, or an error. Named here because it is the state the
majority of users will see the majority of the time, and therefore the one
most likely to be treated as an edge case and get the least care.

### 15.4 Verification bar

Same bar as slice 3, which means the negative walk is a deliverable, not an
afterthought:

1. A student CANNOT read a card in any of `DRAFT`, `SUBJECT_REVIEWED`,
   `FORM_REVIEWED`, `PRINCIPAL_APPROVED` — one case per status, over real
   HTTP, with a `RELEASED` **control** proving the endpoint works at all.
2. A student cannot read another student's card in the same school (the D27
   cross-family case, now on a read).
3. A student cannot read across schools.
4. A guardian sees exactly what their child sees — asserted by comparing the
   two responses for equality in one test, not by two separate assertions
   that could drift apart.
5. A guardian cannot read a child they are not linked to (404/403 split).
6. A `WITHDRAWN`/`GRADUATED` student can still read their released results —
   the direct payoff of PR #183, and the case proving that fix was worth
   making.
7. Mutation check: reverting the status filter must fail the suite.

### 15.5 Open questions

1. **Does a released card become invisible if the school later reopens the
   term?** `released-guard.ts` freezes edits, but reopening is a separate
   flow. Recommended default: **stay visible.** A family that has seen a
   result should not have it silently vanish; if a school must correct one,
   that is a re-release, not a disappearance.
2. **Should the student see their class position?** `overallPosition` is on
   the model. Recommended default: **show it if the school released it** —
   filtering fields per principal reintroduces exactly the drift D30 exists
   to prevent. If a school does not want positions shown, that is a
   school-level setting, not a student-vs-guardian distinction.

### 15.6 Estimate

Smaller than slice 3, because there is no new principal, no new session
table, and no SECURITY DEFINER function — every read runs inside an existing
guard under ordinary RLS. Roughly: shared helper and DTOs, two student
endpoints, one guardian endpoint, two mobile screens, the offline wiring,
and the seven-case negative walk. The gate already exists; this slice
attaches a reader to it.
