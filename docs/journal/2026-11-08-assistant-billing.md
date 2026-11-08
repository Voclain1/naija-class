# 2026-11-08 — assistant workflow chunk 1

## Scope and authorization

Owner requested substantial complete workflow chunks, starting with invoice
preparation and issuance, followed by student intake/enrolment and notifications.
One feature branch / PR carries the whole invoice workflow. No school is enabled.
Existing help/privacy, messaging and behaviour decisions remain unchanged.

## Implementation

`docs/modules/assistant-billing.md` is the contract. Staff invoice screen gains a
feature-gated request/selection → named preview → explicit approval → result and
history flow. The model receives fixed task text and counts through two read
tools only. Raw requests are locally resolved, never sent to the model or stored.
Unknown/conditional instructions require class selection rather than guessing.

The new operational proposal table is FORCE-RLS. Approval rechecks school/user,
grants and full snapshot hash inside a bounded serializable tenant transaction.
The existing invoice and charge services issue ordinary invoices, with assistant
attribution. All writes and the completion marker commit together. No automatic
connection retry on approval; explicit retries return an already committed result.
Larger work will still need the generic journal design; this executor is bounded
to 20 arms / 200 enrolled students, and sends no notification.

## Verification before publication

- 22 local billing unit checks passed.
- 28 existing web checks passed (confirmation logic, accent-border rule, guide index).
- Offline AI eval: 259 checks passed, 1 warning and 5 explicit skips. No live model
  task success is claimed.
- TypeScript checks passed for API, web and e2e; Prisma schema validates.
- Two deliberate breaks (ignoring snapshot fingerprints; dropping unresolved
  instruction words) each failed the relevant test and were restored.
- PostgreSQL and browser integration cases are added for CI's disposable services.
  Local machine has no PostgreSQL/Redis service. A system-package setup attempt
  failed on unavailable privilege changes; no production database was used.
- See PR CI for full-suite, real database, compiled-app and browser results. Do
  not treat this entry as a claim those checks or deployment have completed.
