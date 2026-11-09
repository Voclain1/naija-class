# Assistant billing workflow

## Delivery scope (owner requested, 2026-11-08)

One bundled delivery: ask for a term billing run, review the named students,
amounts and exceptions, explicitly approve, then issue the invoices and inspect
the result/history. Notifications and student administration follow as separate
complete workflow deliveries. This does not activate any school.

The help assistant's incidental-PII exception is not expanded. Billing requests
are resolved locally against the selected term and class catalogue. Raw requests
are never sent to a model or stored. The request resolver currently supports explicit class/level names and all-class billing;
conditional billing, fee edits and notification instructions are refused.
Unknown or ambiguous instructions require
clarification; they are never silently dropped. The budgeted AI tool loop inspects counts and requests a review card only;
financial figures and student identities go directly to the authorised UI.

## Execution contract

- New `assistant-billing` feature, off by default. Existing invoice permissions
  apply; no new role or permission grant. The requester may approve their own
  run, matching the current manual invoicing permission, until a separate
  separation-of-duties decision changes that rule.
- Proposals expire after 30 minutes. Preview includes exact line-snapshot
  fingerprints, roster, skips, due date and selected arms. Issued/cancelled term
  invoices are skipped, as in the existing service.
- Approval rechecks active user, current grants, school status and feature;
  recomputes the preview; rejects any changed fingerprint; and runs within a
  serializable tenant transaction. A proposal row lock serializes double clicks.
- All arm writes, ordinary invoice/charge audits and the completion marker
  commit together. A crash either commits all of them or none. Retrying a
  committed proposal returns its existing result. Serialization failures require
  explicit retry; no background worker or automatic resume exists.
- Bound each proposal to 20 arms / 200 enrolled students so this first atomic
  executor cannot become an unbounded transaction. Larger schools make several
  reviewed runs. Existing per-arm invoice actions remain available.
- Missing fee items block approval. Empty arms and existing invoices are visible.
  Zero-value invoices due to explicit waivers are valid. Discounts and amounts
  are computed only by the existing snapshot service.
- No sends, refunds, transfers, fee edits, report releases, student writes or
  operational action other than term invoice issuance is reachable here.

## API and screen

`/assistant/billing`: availability, scoped context, request/preview, proposal
history, proposal detail and approve. Staff web entry is the invoice screen.
Requests/drafts live only in component memory and clear on account/school change,
sign-out, reload, clear or 15 minutes idle. Proposal records are durable
operational metadata, not conversation transcripts.

## Required verification

Real Postgres: tenant isolation, changed preview, repeat issuance, concurrent
approval, permission loss, inactive school/user, rollback after a later arm fails,
and retry after a committed response is lost. Browser: request → preview →
approve → result; feature-off absence; exception recovery. Unit checks cover
request resolution, snapshot hashing and bigint totals. AI evals must prove
only counts reach the prompt and replies cannot change a billing instruction.

## Activation gate

The new switch stays off. This delivery does not resolve the outstanding legal,
provider-account or consent questions, choose pilot schools, or claim live model
quality. Activation requires the owner's pilot decision, those checks, live task
evaluation and production observations. Haiku 4.5 follows the existing model
registry; this implementation choice is not a recorded owner model approval.
The task prompt receives a fixed sentence, not chat history or raw typed text;
the existing help-assistant exception and its restrictions remain unchanged.

## Status

Implementation in progress. No feature enabled, migration deployed, legal gate
changed or live model quality claimed by this document.
