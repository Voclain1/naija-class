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


## Backend integration follow-up

Backend #517 passed full CI and was squash-merged as `8a57657` under the owner's
standing instruction to merge ready PRs. Frontend #514 remains separate and
adds server-owned review, warnings/errors, explicit refresh and original-proposal
outcome recovery. No backend implementation files are modified here.

CI on #514's first head found two exact-text locator failures after successful
saves and a published guide missing a block present locally. Success copy is
now its own paragraph; the complete guide is restored and regenerated. The
next publication verifies every changed blob against the local Git tree.

Added 15 state-machine tests for request identity, double clicks, refresh,
expiry, malformed outcomes and lost-response recovery. Four additional browser
journeys exercise real proposal endpoints on freshly provisioned test schools.
Full CI on the integrated head is pending. Nothing is enabled for real schools.
