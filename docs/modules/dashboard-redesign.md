# Dashboard redesign — UI implementation

Plan-first. **No UI code written yet.** Scope approved 2026-09-08 from two
Stitch-generated mockups (main Dashboard, Finance Dashboard), already triaged.

Part of the visual/UX overhaul initiative (CLAUDE.md "Design system"), not a
numbered Phase. Builds on completed backend work: the revenue trajectory
endpoint (#277, awaiting review), the school profile card (#280, CI green),
and the three accuracy fixes (#278, merged and deployed).

## 1. The headline: most of this already exists

The mockups are a restyle of a working product, not a spec for new features.
Verified against the code, the approved scope breaks down as:

| Item | Status |
|---|---|
| Metric cards | Built — `(admin)/dashboard/page.tsx` |
| Attendance chart | Built, and just fixed (#278 defect 1) |
| Collection by class level | Built — `collectionByGroup` |
| "Needs you today" feed | Built — `needsYouToday`, 3 alert types |
| Campus profile card | Built — #280, awaiting merge |
| Student roster table | Built — `(admin)/students/page.tsx`, 339 lines |
| Revenue trajectory chart | Built — #277, awaiting review |
| Overdue table + bulk actions | Built — `/finance/debtors`, `POST /finance/debtors/remind` |
| **A — Command palette** | **Mostly built** — see D1 |
| **B — Ledger shortcut** | **Not built** — trivial, see D1 |
| **Invoice breakdown by class** | **Not built on finance** — aggregation exists, wrong page (D3) |

So the genuinely new UI work is small. The bulk of the effort is restyling
surfaces that already work, which carries a specific risk worth naming up
front: **a restyle that quietly drops working behaviour is a functional
regression dressed as a visual change.** `nav-items.ts` already carries a
comment about exactly this trap, from the last time a mockup greyed out
shipped features. The same discipline applies here.

## 2. D1 — The A/B shortcuts

**A — Command.** The command palette already exists:
`components/admin/command-dialog.tsx` (118 lines), bound to ⌘K/Ctrl+K via
`useCommandDialogHotkey`, mounted in `topbar.tsx`, and driven by the same
`NAV_ITEMS` the sidebar uses — so it already "lists all menu/nav items" as
the scope requires. It is opened today by clicking the search bar.

**What is missing is only the visible `A` pill.** The topbar renders the
search input and the ⌘K hint, not the two pill buttons the mockup shows.

**B — Ledger.** Not built. It is a `router.push("/finance/dashboard")` — the
same href `NAV_ITEMS`' Finance entry already uses.

**Decision: both pills render from one shared `QuickActionPill` component,
and B reuses the Finance nav item's href rather than hardcoding a second
copy of the string.** If Finance ever moves, one edit moves both.

**Permission gate, easy to miss:** the Finance nav item is gated on
`finance.dashboard.read`. The B pill must carry the *same* gate, or a role
without finance access gets a visible button that 403s. `useVisibleAdminNavItems()`
already computes this — derive the pill from the filtered list, do not
re-implement the check.

## 3. D2 — Typography: brand fonts stay, nav weight increases

**Fraunces + Hanken Grotesk stay.** The mockup's Newsreader / Plus Jakarta
Sans are explicitly rejected. Both current faces are loaded via
`next/font/google` in `app/layout.tsx` and mapped to `--font-serif` /
`--font-sans` in `globals.css`; nothing about that changes.

**The one deliberate change: sidebar/nav text gets bolder.** This is a single
edit in `nav-list.tsx`'s `NavLink`, not a global font change — nav labels
only. The "Coming soon" section header is already `font-semibold`; the change
is to the item labels themselves.

**Do it as a token, not a sprinkle.** `NavList` is shared by the desktop
rail, the mobile drawer, AND the teacher portal's sidebar. One weight change
lands in all three, which is correct and consistent — but it means the change
must be made once in `NavLink`, not per-container. Verify the teacher portal
visually too, since it inherits this for free.

## 4. D3 — Finance dashboard: what actually needs building

The finance dashboard currently renders a collection-rate meter, a 6-tile KPI
row, and (after #277) the trajectory chart.

**Invoice/collection breakdown by class level is the one genuinely missing
piece.** The aggregation exists — `buildCollectionByGroup()` in
`dashboard.service.ts` — but it lives on the ADMIN dashboard's endpoint. This
is a lift-and-reuse:

1. Extract `buildCollectionByGroup` to a shared module (it is already a pure
   function taking two arrays).
2. Add the group array to `FinanceDashboardDto`.
3. Render with the existing group-row markup.

**Carry the #278 fix with it.** That helper now emits an `"unassigned"` bucket
so the rows sum to the fees total. Porting an older copy would reintroduce the
defect on a second screen.

**The overdue table stays at `/finance/debtors`.** The mockup implies it on
the dashboard; it already exists as a full page with row selection, select-all
and batch reminders, capped at 50 ids. **Decision: link to it, do not
duplicate it.** A second copy of a bulk-mutation surface is two places to keep
a 50-id cap and a permission gate correct. The dashboard gets the
`Batch Reminders` affordance the mockup shows, wired to navigate.

## 5. D4 — Lesson Notes is NOT a label flip

The scope says "Lesson Notes: SOON → update to reflect it's live". The code
does not support a one-line fix:

- `LATER_PHASE_ITEMS` in `nav-items.ts` has
  `{ label: "Lesson Notes", href: "/lesson-notes", enabled: false }`.
- **`/lesson-notes` does not exist.** No such route in the `(admin)` shell.
- The shipped feature is `(teacher)/teacher/lesson-plans`, in the TEACHER
  shell, and it is already `enabled: true` in the teacher sidebar.

So the admin sidebar advertises a route that was never built, for a feature
that shipped somewhere else under a different name.

Three options, none free:

| Option | Cost | Notes |
|---|---|---|
| a. Point the admin item at `/teacher/lesson-plans` | Trivial | Works — `(teacher)/layout.tsx` has NO role gate (bare `RequireAuth`), so an admin can open it. But it jumps shells, and the topbar/sidebar change under the user. |
| b. Build an admin lesson-plans view | Days | Real work, well outside a restyle. |
| c. Remove it from the admin sidebar | Trivial | Honest: it is a teacher feature, and owner/admin do hold `lesson-plan.*`, but the admin shell has no surface for it. |

**Recommendation: (a), with the label corrected to "Lesson plans"** to match
what the feature is actually called everywhere else, moved out of
`LATER_PHASE_ITEMS` into `NAV_ITEMS` gated on `lesson-plan.read`. It is the
only option that satisfies "reflect it's live" without inventing a page. The
cross-shell jump is a real wart and should be called out in the PR rather
than hidden.

**This needs your decision before implementation.** (a) is a real navigation
change, not a label edit, and I would rather ask than pick.

## 6. D5 — The "drop entirely" list costs nothing

Verified by grep across `apps/web/src`: **none of the fabricated features
exist in the codebase.** ESC-POS / thermal printing: no matches. "3.4
seconds" webhook timing: no matches. "Parent Portal Gateway … READY": no
matches. The only `subaccount` matches are in
`settings/finance/payments/page.tsx` and the platform-admin dashboard —
legitimate Paystack setup surfaces, not a dashboard banner, and the mockup's
visible account number is not rendered anywhere.

So "drop" means **do not build**, not "remove". Zero work. Recorded here so a
future reader does not go hunting for code to delete.

The one thing to actively watch: the mockup's `BURSARY TERMINAL ·
Paystack Subaccount: #3021949182 (Wema Bank)` header line must not be
reproduced. Account numbers on a page that renders on every finance visit is
the same reasoning that keeps banking details out of
`platform_admin_list_paystack_setup_requests` (CLAUDE.md SECURITY DEFINER
inventory) — a per-visit exposure through logs, screenshots and screen
shares, for information nobody needs at a glance.

## 7. Component structure

No new architecture. The existing pattern holds: page-level client component
fetches, presentational components under `components/admin/` and
`components/finance/`, pure logic extracted to a sibling module with a
`.spec.ts` when it needs proving (`apps/web` has no DOM test setup by
deliberate choice — see `vitest.config.ts`).

```
components/admin/
  quick-action-pills.tsx        NEW — A/B pills, derived from filtered nav
  nav-list.tsx                  EDIT — nav label weight (D2)
  nav-items.ts                  EDIT — Lesson plans (D4)
  school-profile-card.tsx       existing (#280)
  attendance-sparkline.tsx      existing (#278)
components/finance/
  collection-by-level.tsx       NEW — shared group rows, used by BOTH dashboards
  revenue-trajectory-chart.tsx  existing (#277)
```

`collection-by-level.tsx` is deliberately shared rather than copied: the same
rows render on the admin dashboard and the finance dashboard, and the
`"unassigned"` bucket's meaning must not diverge between them.

## 8. Tests

- Pure logic only, per the app's testing posture. The A/B pills' permission
  derivation is the one piece with real branching — it gets a `.spec.ts`
  asserting a bursar sees B and a role without `finance.dashboard.read`
  does not.
- `nav-items.ts` change: assert Lesson plans is enabled and carries
  `lesson-plan.read`, so a future permission edit fails loudly.
- Everything visual goes to Playwright, which already covers the admin shell
  (`a11y-wave3a.spec.ts` exercises the finance selectors and sub-nav).
- **Watch the a11y suite specifically.** The trajectory chart broke it once
  already via an `aria-label` colliding by substring with the term `<select>`.
  New pills labelled "A" and "B" near a search box are exactly that hazard
  again — `getByLabel`/`getByRole` name collisions. Give them explicit,
  distinctive accessible names ("Open command palette", "Go to finance
  ledger"), not "A" and "B".

## 9. Estimate

| Work | Days | Confidence |
|---|---|---|
| A/B quick-action pills + permission gate + spec | 0.5 | High |
| Nav typography (D2), incl. teacher-portal check | 0.25 | High |
| Lesson plans nav fix (D4, option a) | 0.25 | High — if (a) is chosen |
| Collection-by-level shared component + finance wiring | 1 | High |
| Main dashboard restyle to mockup | 1.5 | Medium — pure visual iteration |
| Finance dashboard restyle to mockup | 1 | Medium |
| Playwright pass + a11y fixes | 0.75 | Medium — see §8 |

**Total: 5–5.5 days.**

Lower than the mockups suggest, because the features are built and this is
mostly styling. The Medium-confidence rows are the restyles: visual iteration
against a mockup is the least predictable work here, and neither row includes
a second round of design feedback.

**Not included:** any change to the metric set, new endpoints, a chart
library (still hand-rolled SVG throughout), or dark-mode re-tuning beyond
keeping existing tokens working.

## 10. Sequencing

1. #277 and #280 merge first — this plan edits files both touch.
2. Nav changes (D2, D4) — smallest, independently verifiable.
3. Shared collection-by-level (D3) — backend DTO + both call sites.
4. A/B pills (D1).
5. Restyle passes, main dashboard then finance.
6. Playwright + a11y.

Steps 2–4 are safe to ship incrementally. The restyle passes are where
review feedback lands, so they go last.
