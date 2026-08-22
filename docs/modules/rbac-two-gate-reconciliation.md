# RBAC: reconciling the two authorization gates

Plan-first. **Nothing in this document is built yet.** Commissioned 2026-08-22
after the same failure shape produced four production bugs in three weeks.

## 1. Why this exists

Four role bugs have shipped and been fixed. They are not four unrelated
mistakes; three are one defect and the fourth is its mirror image.

| # | Bug | Where the disagreement was | How it was found |
|---|---|---|---|
| 1 | Bursar locked out of the admin shell | ROLE list in the web shell (`RequireAuth roles={…}`) | Browser |
| 2 | Bursar held no `academic-year.read`/`term.read`/`class-arm.read` | PERMISSION list | Browser |
| 3 | That grant was **inert for 19 days** | ROLE list in the SERVICE, one layer below the fix | Browser |
| 4 | `admin` never held `dashboard.read` | Permission ENFORCED, granted to no role | Browser (e2e) |

**1–3 are the same defect: two authorization systems that never consult each
other.** A permission can be granted correctly and still do nothing, because a
role list somewhere else rejects the caller first. **4 is the inverse** — a
permission enforced that no role holds.

Two facts make this worth structural work rather than more vigilance:

- **Every one was found in a browser. None by CI.** Bug 3's own regression
  test was green for the entire 19 days it was broken, because it asserted
  `guard.canActivate()` and stopped one layer above where the rejection
  happened.
- **Twice, one fix uncovered the next.** Fixing #2 created the conditions for
  #3; fixing #198 (the academic calendar) exposed #4, which had been masked
  because the dashboard never called its API without a term. There is no
  reason to think the sequence has ended.

## 2. The inventory, measured — and a correction

**Previous estimates in `docs/deferred.md` and in the #202 recommendation said
"~20 call sites". That was wrong by roughly 7×.**

Measured against `apps/api/src` on 2026-08-22:

| Metric | Count |
|---|---|
| `assertUserActiveAndHasOneOf(...)` call sites (excl. specs/helper) | **145 raw / 132 parsed to a method** |
| Service methods whose controller handler ALSO carries `@Permissions` | **~89** |
| Service methods where the role check is the ONLY gate | **~6 confirmed, more likely** |
| Call sites whose controller handler could not be matched by name | **37** |

Top concentrations: `guardians` (10), `grading` (9), `students` (7),
`imports` (7), `assessment` (7), `class-subjects` (6).

**Measurement caveats, stated because they bound what the plan can promise:**

- The 37 unmatched sites are a *naming* limitation — controller handler names
  often differ from the service methods they call — not evidence of dead code.
  They need a manual pass.
- "Controller has no `PermissionsGuard`" was detected by string match, which
  produces false negatives: `academic-calendar.controller.ts` mentions the
  guard only in a comment and was wrongly excluded. Treat the 6 as a floor.
- Per-handler variation is real: `UsersController` carries `PermissionsGuard`
  and `@Permissions` on `list`/`listInvitations` but **not** on
  `invite`/`completeTour`.

**This correction is the most important content in this document.** A 132-site
change to shared auth code is a different proposition from a 20-site one, and
it is the main input to §4's recommendation.

## 3. What the helper actually does — it is two gates in one

`common/auth/role-check.ts`:

```ts
export async function assertUserActiveAndHasOneOf(authCtx, allowedRoleKeys) {
  // one fetch, two assertions
  if (!isActive) throw new UnauthorizedError("USER_INACTIVE", …);
  if (!roleKeys.some(k => allowedRoleKeys.includes(k))) throw new ForbiddenError(…);
}
```

1. **The `isActive` re-check.** Required by CLAUDE.md's auth rule — *"Never
   trust the JWT subject alone for mutations. Re-fetch the user (and verify
   `is_active`) on every write."* A deactivation can land between requests.
   **This half must survive untouched, everywhere.**
2. **The role check.** The half that duplicates — and can contradict —
   `@Permissions` + `PermissionsGuard`.

The helper's own header describes itself as being for *"every handler that
performs a tenant-scoped **mutation**"*. **The read paths were arguably never
its intended scope**, which is a useful starting point: the bug-3 fix widened
seven read paths precisely because the role check had no business gating them.

## 4. Options, and the recommendation

### Option A — split the helper, remove the redundant role half

`assertUserActive()` everywhere; drop the role list where `@Permissions`
already covers the handler.

Correct in principle, and it is what "fix it properly" means. But it edits
~89 call sites of authorization code across every module, in a codebase where
the last four bugs of this exact kind were caught only in a browser and the
local test suite flakes under memory pressure. The failure mode of getting one
wrong is silent over-permissioning on money or student-record endpoints.

### Option B — make the helper permission-aware

Replace role lists with permission checks inside the helper. Removes the
duplication rather than the redundancy. But it needs a permission for every
call site, including places that today express genuinely role-shaped rules
(`["owner"]`-only history-bearing deletes, `["teacher"]` in teacher-scope), and
inventing permissions to fit them is a schema change wearing a refactor's
clothes.

### Option C — a conformance gate that makes the two systems agree, and keep them

Do not remove the second gate. **Make disagreement impossible to ship.**

A spec that, for every route handler, cross-references:
its `@Permissions` value → which seeded roles hold that permission → the role
list its service asserts. Any disagreement fails CI.

This is the pattern this codebase already uses and trusts:
`security-definer-inventory.spec.ts` replaced *"if it grows past 5, refactor"*
— a human-memory threshold — with a standing gate that holds at any count.
CLAUDE.md says so in those words. The same reasoning applies here, and the
present situation is worse than the one that motivated it: the human-memory
rule here has failed four times in three weeks.

### Recommendation: **C first, then A incrementally, and never B**

Concretely:

1. **Ship the conformance gate alone, in its own PR, changing no behaviour.**
   Assert the invariants in §5. Expect it to fail on landing — every
   disagreement it finds is a latent bug 3 or bug 4. Fix those individually,
   each with its own evidence, exactly as #200 and #201 did.
2. **Then** remove redundant role checks module by module, with the gate
   already in place to catch a mistake. Not one 89-file PR.
3. **Never B.** Inventing permissions to fit role-shaped rules is a bigger,
   less reversible change than the problem justifies.

The honest argument for C-before-A: **A fixes the duplication; C fixes the
bugs.** Every one of the four shipped because nothing *detected* the
disagreement — not because the second gate existed. A gate that holds at 132
call sites is worth more than a refactor that reduces them to 89, and it makes
the refactor safe to do afterwards.

## 5. The invariants the gate asserts

For every route handler carrying `PATH_METADATA`:

- **I1 — no orphaned enforcement.** Every permission declared in
  `@Permissions` is held by **at least one** seeded role.
  *Catches bug 4 directly.* `dashboard.read` was enforced on
  `DashboardController` and granted to nobody; this fails immediately.
- **I2 — no inert grants.** If a role holds the permission a handler
  declares, that role must not then be rejected by the role list its service
  asserts. *Catches bug 3 directly* — bursar held `academic-year.read` and was
  rejected by `["owner","admin"]` one layer down.
- **I3 — no unknown permission strings.** Already partly covered per-phase;
  generalise it so new phases are covered without editing the spec.
- **I4 — the `isActive` half is never dropped.** Every service method that
  performs a mutation still calls the active-check. This is the guard rail
  that makes step 2 of the rollout safe.

I1 and I2 are the two that would have caught the four real bugs. I3 and I4 are
cheap and prevent the obvious regressions of doing this work.

**Known implementation difficulty, not hand-waved:** I2 needs a handler → service
-method mapping, and §2 shows naive name-matching leaves 37 unmatched. Options:
resolve through the Nest DI container at test time (accurate, heavier), or
require an explicit annotation on the service method (mechanical, and the
annotation itself documents the pairing). **Prefer the DI-container route**;
fall back to an explicit map with a spec that fails when a call site is absent
from it, so the map cannot silently rot.

## 6. Rollout

1. **PR 1 — the gate, failing.** Land it with the known-failing cases
   `it.fails`-marked or explicitly allowlisted with a comment naming each. A
   green-on-arrival gate here would mean it is not looking hard enough.
2. **PR 2..n — one module per PR**, clearing allowlist entries as the
   disagreements are fixed. Each carries its own browser verification for the
   affected role, because that is the only thing that has reliably caught
   these.
3. **Then** the Option A cleanup, module by module, gate already standing.

**Verification standard, non-negotiable given the history:** every role whose
grants change gets an actual login in a real browser. All four bugs passed CI.
`bursar-scope.spec.ts` now has the right shape to copy — it calls the SERVICES,
not just the guard.

## 7. Scope

**In:** the conformance spec and its invariants; the handler↔service mapping
mechanism; an allowlist of existing disagreements, each annotated; fixes for
what it finds, one module at a time.

**Out (deliberately):** the ~89-site removal of redundant role checks — that is
step 3, after the gate stands. Option B. Any change to the `isActive` half.
Guardian/student/platform-admin principals, which have their own auth paths and
are not part of this staff-role defect.

**Also flagged, not fixed:** the web shell has its OWN role list
(`RequireAuth roles={["owner","admin","bursar"]}`) which produced bug 1 and
which a server-side spec cannot see. Worth a follow-up that derives the shell's
role list from permissions the same way `useVisibleAdminNavItems()` already
derives nav items.

**Estimate:** PR 1 is a focused piece of work — the spec plus the mapping
mechanism, no behaviour change. The follow-up PRs are small and independent.
This is deliberately structured so the valuable half ships first and the risky
half is optional and incremental.

**Sequencing:** agreed 2026-08-22 to run before the payment-link build. The
payment-link work stays queued, including its one open question (whether a
single `percentage: 100` split can be reused across invoice amounts —
`docs/modules/shareable-payment-links.md` D12 item 4).
