# 2026-11-09 — notification/SMS workflow, frontend chunk

Owner requested the next complete workflow chunk after student intake. The
recorded order is invoices → intake/enrolment → notification/SMS campaigns →
record updates. Claude retains backend ownership; ChatGPT builds staff web.

Built `/finance/reminders`: term/audience filters, payment-plan exclusion,
student-level dedupe across invoices, explicit fresh review, channel settings
when readable, human confirmation, sequential batches of 50 (max 500) and
per-batch results. Debtor-list send now opens that same review. An uncertain
send stops the run without retry, preserves confirmed results and leaves later
batches not requested. No client money totals, AI call or channel toggle added.

Backend campaign history/dedupe/status/recovery does not exist yet. A complete
backend brief is committed beside the module doc; the frontend does not call
invented endpoints or claim durable protection. Draft/result data stays only
in page memory. Browser/API verification is pending on the PR head.

26 focused unit cases passed before publication, covering filtering, result
reconciliation and lifecycle/recovery boundaries. Browser journeys added for
real no-guardian API results, refreshed eligibility, uncertain outcomes, all
channels off, UI permission refusal and debtor-list review. No real family is
contacted by fixtures. Full local checks and CI results belong in the PR.


Full web regression validation: 654 tests pass across 85 files after merging current main. Web lint and
web/E2E TypeScript checks pass. The forced-sign-out inventory caught the new
beforeunload handler; it now stands down for forced navigation and is covered
by the existing invariant suite. Six browser journeys await CI execution.


Student intake #514 finished green on its latest head and merged as `63cf11e`.
This branch includes that main update; the reminder PR diff remains frontend
only. Deliberate breakages of student dedupe, uncertain-send retry refusal and
the forced-sign-out guard each failed their relevant test, then were restored.
