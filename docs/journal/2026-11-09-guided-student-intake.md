# 2026-11-09 — guided student intake frontend

Owner split: Claude builds backend unless on limit; ChatGPT builds frontend.
This chunk composes existing endpoints only. No backend, schema, shared DTO,
model prompt or feature-switch changes.

New `/students/intake` route offers guided class-list entry and links to the
existing single-student, CSV and AI register-scan flows. The guided grid requires
an explicit term and placement/defer decision, then shows immutable pending rows
in a human-confirmed review. Saved rows are excluded from retries; server
validation and existing per-request atomic enrollment remain authoritative.

Both grids stop after an unconfirmed response and disable retry. This matters
for automatic admission numbers: a lost response can follow a committed save.
Known confirmed counts stay separate from unknown outcomes. No draft storage or
new personal-data analytics/model path is added. Impossible dates and unknown
genders are rejected locally before review; fields freeze while saving.

Backend handoff: `docs/modules/guided-student-intake.md` records the current
contract and the server idempotency/outcome/proposal capabilities needed for a
later conversational agent. No speculative endpoint is called.

Local validation: 40 focused unit checks passed, web lint, web/e2e typechecks and guide
index regeneration. Six browser journeys are added, including desktop/phone
review attachments and a genuinely committed save with a dropped response.
Full browser and existing regression verification require the PR CI's disposable
database services. No merge, deployment, assistant activation or live model
quality is claimed here.
