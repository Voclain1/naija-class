# Sprint 1–3 delivery CI follow-through — 2026-11-17

PR #550, head 7b30358a: CI #1370 passed lint, typechecks, unit tests, migrations and builds. Playwright retried obsolete UI expectations until the one-hour job timeout; the run was cancelled before its final report.

Updated only affected browser tests: New fee group; Record payment; Fees & payments; active subject links without removed teacher-assignment badges; no unavailable Coming soon placeholders; and the intake workspace class/review controls instead of a help control belonging to the old bulk route. The incident-history test explicitly gives its isolated school null module preferences, covering the preserved legacy Behaviour profile tab.

Validation: source comparisons against the exact PR head; syntax checks recorded by the delivery run. Full browser/database execution remains CI's gate. No merge or VPS deployment has been claimed. Continue on the new head, require all PR checks, squash merge, then verify main CI and deploy-vps migration plus production smoke before declaring all three sprints deployed.

## CI #1371 follow-up

The previous five edited browser files pass in CI. The run again passed the non-E2E job but timed out in Playwright. Corrected the next source-confirmed stale controls: Add a class list in guided intake (including reload and permission assertions), Fees & payments in the guardian-roster bursar check, Class placement and the empty-roster explanation in first-school setup, and the explicit alternate-total checkbox in both gradebook-out-of and exam-papers. Money assertions, database verification, approval gates and lost-response checks remain in place. Syntax validation is performed before pushing; full integration validation stays with CI.

## Full-suite CI #1372

Playwright completed in 47.2 minutes: 238 passed, eight failed; the other CI job passed. Earlier corrected tests are green. Exact failure logs identify optional modules absent from new-school defaults (hostel/library/transport profile fields and Reports/Store menu links), the renamed Class history tab, the removed Add students chooser in scan reachability, and the tour's synchronous card count seeing its temporary fallback.

Added an optional modules argument to the new-school test fixture, preserving normal defaults and explicitly selecting each specialist area through the real schools/me API. The full-profile phone audit explicitly represents a legacy school. Updated the tab and scan path, and made the tour wait for every expected spotlight before counting/measuring. All workflow, money, approval and accessibility assertions remain. Syntax checks run before push; full browser validation remains CI's gate.
