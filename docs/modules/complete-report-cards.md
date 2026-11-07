# Complete report cards (owner approved 6 November 2026)

Free provides a complete Nigerian report: school identity/logo/contact, learner
identity/photo, configured assessment components and maxima, grades/key,
attendance, optional positions, cumulative results, standard affective and
psychomotor ratings, teacher/head comments, signature spaces and resumption.
Academic settings and level-appropriate nursery/primary/secondary labels are
not design upgrades. Missing observations are explicitly not recorded.

Paid design controls: standard/classic/compact layouts, validated hex colour,
sans/serif typography, text watermark and up to eight labelled additional text
fields. Existing PLAN_ENFORCEMENT warn/enforce behaviour is preserved; AI draft
entitlements are unchanged. Logo identity and positions are no longer paid-only.

Additive JSON columns on schools and report_cards use existing tenant scope.
School design is edited through PATCH /schools/me (owner/admin). Observations,
level, next-term date and signature names use PATCH /report-cards/:id beside
form comments, with its existing owner/admin/form-teacher and editable-state
checks. The write rechecks editable status atomically, including when form review
races an edit. They lock at form review; released cards require the existing reopen.
Custom labels are canonicalised server-side against paid school definitions.
No new permission or unaudited write path is introduced.

PDF rendering embeds tenant-owned images outside the transaction, escapes all
text, validates CSS inputs and retains continuation pages for large subject
sets/comments. Existing frozen PDFs are not rewritten automatically. New
profile values are stored on the card, not recalculated from behavioural
incidents; a rebuild retains them like comments. School design changes apply
to later renders, matching the existing school branding behaviour.

Implementation verification and boundaries are recorded in the dated journal.

## Header and workflow refinement (6 November)

The standard Free masthead centres a 26px extra-bold school name alongside a
64px school logo, retaining the school contact details and optional learner
photo. The header has only a neutral bottom divider, with no surrounding box
or rounded border (owner revision). Free school logos are loaded from the existing tenant-owned upload; no
fake logo is substituted when a school has not uploaded one. The fictional
review example uses a demonstration crest to make the intended result visible.

The board shows five numbered steps: prepare scores, review each card, school
approval, release results, download/print. Guidance explains the next action
for the current role/state, saving comments/observations before submission,
final-term promotion decisions, when parents can see results, PIN confirmation
and PDF readiness. Buttons use Send for approval / Approve report cards /
Release results. These are presentation changes to the existing state machine;
no approval gate, role permission or release confirmation is removed.
