# SchoolKit Assistant — AI governance, data minimisation and controlled activation

Status: **built (2026-11-22).** The FICTIONAL release can be authorised by the platform admin once three human attestations are recorded. The LIVE release **cannot** be authorised yet: it stays blocked on CLAUDE.md's allowlist row (AO-1) and the legal, provider and policy attestations.
Security report, with the field-level data-flow inventory: [`docs/security/assistant-ai-security-report.md`](../security/assistant-ai-security-report.md).

This replaces the single code constant `ASSISTANT_ORCHESTRATOR_APPROVAL` as the
**runtime** gate for AI understanding (`docs/modules/assistant-workspace.md`,
"Model orchestration"). The constant still exists, unchanged. It is now one
requirement of the LIVE release, so live children's data still cannot reach a
model without the owner's CLAUDE.md row. A pilot that holds only invented
records no longer has to wait for it.

## 1. The three independent controls

A staff member's text reaches a model provider only when **all** of these
hold. The server reads them on **every** turn, with no cache in between:

| # | Control | Who sets it | Where |
|---|---|---|---|
| 1 | **Release authorisation** for the school's data scope (FICTIONAL or LIVE): every requirement verified or attested, then authorised, and not revoked since | Platform admin | `ai_release_events` (platform-level, append-only) |
| 2 | **School classification and switch**: `schools.ai_data_classification` picks the scope; `assistant-model-routing` switches the school on | Platform admin only | `schools` |
| 3 | **School owner's acceptance** of the current AI terms | School owner only | `school_ai_terms_events` (RLS, append-only for updates) |

The existing controls also still apply: the `assistant-workspace` switch,
`FEATURES_DISABLED`, `AI_ENABLED`, the provider key, the school's `aiEnabled`,
the AI token budget, and the per-person rate limit.

Enforcement of 1 and 3 is **always on in production**. Elsewhere it is off
unless `AI_RELEASE_ENFORCEMENT=on`, so local development and the existing test
suites keep working. The governance tests turn it on.

`ModelRoutingGate.status` (`apps/api/src/modules/assistant-workspace/orchestrator/model-routing-gate.ts`)
returns these reasons, and the panel already falls back to the deterministic
router for each:

- `NOT_APPROVED`: the release for the school's scope is not authorised.
- `FEATURE_OFF`: the school's switch is off. It is read from the row on each turn, not from the 30-second cache.
- `TERMS_NOT_ACCEPTED`: the school owner has not accepted the current terms.
- `AI_UNAVAILABLE`: AI is off or not configured.

## 2. Release authorisation (replaces the code-level deadlock)

The requirements are code (`packages/ai/src/release/ai-release-requirements.ts`,
version `AI_RELEASE_REQUIREMENTS_VERSION`). There are two kinds:

- **engineering**: the status is set in code, in a reviewed change. It counts as
  `verified` only with evidence, meaning a spec that names the check in a test
  title (`[release-check:<id>]`). `ai-release-requirements.spec.ts` fails CI if
  the evidence file is missing or does not name the check.
- **attestation**: a fact only a person can confirm, such as counsel's
  conclusion, the provider console, or what a pilot school holds. The platform
  admin records it through the API, with a reference to the evidence. The
  record stores the requirements version and a SHA-256 of the exact statement.
  If the wording or the version changes, the attestation stops counting.

| Requirement | Kind | FICTIONAL | LIVE | Status now |
|---|---|---|---|---|
| `eng.tenant-isolation` | engineering | ✓ | ✓ | verified |
| `eng.tool-authorisation` | engineering | ✓ | ✓ | verified |
| `eng.no-approval-path` | engineering | ✓ | ✓ | verified |
| `eng.pseudonymisation` | engineering | ✓ | ✓ | verified |
| `eng.prompt-injection` | engineering | ✓ | ✓ | verified |
| `eng.no-content-retention` | engineering | ✓ | ✓ | verified |
| `eng.kill-switch` | engineering | ✓ | ✓ | verified |
| `eng.terms-gate` | engineering | ✓ | ✓ | verified |
| `eng.fictional-classification` | engineering | ✓ | | verified |
| `live.allowlist-row` (AO-1 in CLAUDE.md + `ASSISTANT_ORCHESTRATOR_APPROVAL`) | engineering | | ✓ | **open** |
| `att.fictional.records-only` | attestation | ✓ | | **open** (a person must record it) |
| `att.fictional.staff-briefed` | attestation | ✓ | | **open** |
| `att.provider-retention` | attestation | ✓ | ✓ | **open** |
| `att.live.counsel` | attestation | | ✓ | **open** |
| `att.live.terms-and-notices` | attestation | | ✓ | **open** |
| `att.live.release-evals` | attestation | | ✓ | **open** |

No attestation was recorded by this change, and none can be recorded in code.

**Authorise** is refused (`409 AI_RELEASE_INCOMPLETE`, with the open ids) until
every requirement for the scope is verified or attested. **Revoke** is the kill
switch for the whole scope: every school of that scope stops at its next
request, and its voice sessions end there (`REVOKED`). Re-authorising does not
need new attestations unless the requirements version changed.

`ai_release_events` has no `school_id`; like `schools`, it is about the
platform. The runtime role may insert and read only. `UPDATE` and `DELETE` are
revoked in the migration, which the governance spec proves.

## 3. Data classification and the fictional-data pilot

`schools.ai_data_classification` is `LIVE` (default) or `FICTIONAL`.

- Only the platform admin sets it (`PATCH /platform-admin/schools/:id/ai-data-classification`),
  and only while the school holds **no student or guardian records**. Real
  records can therefore never be relabelled fictional, and fictional ones never
  relabelled live.
- A change switches `assistant-model-routing` and `assistant-voice` off for
  the school and is audited.
- A FICTIONAL school needs the FICTIONAL release; a LIVE school needs the LIVE
  release. A fictional release never unlocks a live school, including if its
  switch is forced on in the database. The governance spec proves this.

`POST /platform-admin/schools/:id/fictional-pilot/seed` fills an empty
FICTIONAL school with invented records
(`apps/api/src/common/ai-release/fictional-pilot-seed.ts`):

- an academic year with three terms;
- five classes, JSS 1 to JSS 3;
- 30 students with invented surnames and `PILOT-###` admission numbers, each enrolled;
- 30 guardians at `@example.test` (reserved, RFC 2606), with `+2340000000###` phone numbers (not a Nigerian mobile prefix, so not routable);
- one fee item.

It writes through `withTenant` under RLS and is audited.

### Virgo Fidelis fictional pilot: steps

The real Virgo Fidelis Montessori School stays **LIVE**, with AI
understanding off. The pilot is a **separate school tenant** that holds
invented records only.

1. **Platform admin:** create the pilot school (`POST /platform-admin/schools`).
   Name it e.g. "Virgo Fidelis Montessori — AI pilot (fictional data)" and use
   the pilot coordinator's email as owner.
2. **Platform admin:** classify it **before anything is entered**:
   `PATCH /platform-admin/schools/<id>/ai-data-classification {"classification":"FICTIONAL"}`.
3. **Platform admin:** `POST /platform-admin/schools/<id>/fictional-pilot/seed`.
4. Switch on, through the existing console or `PATCH …/features`:
   - `assistant-workspace` and the task switches you want to test;
   - set the school's AI budget (`PATCH …/ai-budget`) and voice budget if needed.
5. **The person who can truthfully attest** records the three FICTIONAL
   attestations (`POST /platform-admin/ai-release/FICTIONAL/attestations`, one
   per requirement, with `confirm: true` and a reference). This is normally the
   owner, acting as platform admin.
   - `att.fictional.records-only`: the pilot holds invented records only.
   - `att.fictional.staff-briefed`: testers were told in writing to use no
     real personal data, and how to report it.
   - `att.provider-retention`: the production keys' organisations were checked
     (no training; standard retention up to 30 days; zero data retention not
     enabled), and this is accepted for fictional data.
6. **Platform admin:** `POST /platform-admin/ai-release/FICTIONAL/authorise`.
7. **Platform admin:** switch `assistant-model-routing` (and `assistant-voice`
   if testing voice) on **for the pilot school only**.
8. **The pilot school's owner:** Settings → Data protection → "SchoolKit
   Assistant: AI terms" → tick → Accept.
9. Test. Any real personal data entered is an incident: revoke the release
   (`POST /platform-admin/ai-release/FICTIONAL/revoke`) and follow the release
   stop conditions in `docs/reviews/virgo-assistant-pilot-signoff-register.md`.

The release routes have no console UI yet. While signed in to the super-admin
console, call them from the browser's developer console. The session cookie
goes with the request:

```js
await fetch("https://api.schoolkit.ng/api/v1/platform-admin/ai-release", { credentials: "include" }).then((r) => r.json());
await fetch("https://api.schoolkit.ng/api/v1/platform-admin/ai-release/FICTIONAL/attestations", {
  method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ requirementId: "att.fictional.records-only", confirm: true, reference: "Pilot tenant created 2026-11-23; seeded only; see pilot log" }),
}).then((r) => r.json());
```

## 4. School AI terms

`SCHOOL_AI_TERMS_VERSION` and `SCHOOL_AI_TERMS_POINTS` live in
`packages/types/src/assistant/governance.ts`. The wording is versioned like the
data-protection consent (CLAUDE.md, Consent): changing what a school agrees to
means a new version, which asks the owner again. The wording states the facts
verified on 2026-11-22:

- Anthropic receives the text, and OpenAI receives voice audio and spoken
  replies.
- Names are replaced and identifiers blocked, but the checks are not perfect.
- The providers' standard API terms keep data for up to 30 days and do not use
  it for training; zero data retention is not arranged.
- SchoolKit stores no conversations.
- The Assistant prepares only; approval is on the card.
- Only SchoolKit switches the feature on, and the school can withdraw.

It is an **engineering draft**. Counsel's approval of it is part of
`att.live.terms-and-notices`.

Endpoints:

- `GET /schools/me/ai-terms`: any signed-in staff member.
- `POST /schools/me/ai-terms/accept {version, accept: true}`: owner only, and
  `version` must equal the current version.
- `POST /schools/me/ai-terms/withdraw {withdraw: true}`: owner only. It ends
  the school's live voice sessions at once.

Ownership and active status are read from the database on each write. Each
decision is a new row (version, SHA-256 of the exact wording, user, time, IP)
plus an audit row. The latest row decides. **Accepting never switches anything
on.**

UI: Settings → Data protection → "SchoolKit Assistant: AI terms"
(`apps/web/src/components/legal/ai-terms-section.tsx`).

## 5. Data minimisation (egress)

Before a provider sees anything:

1. **Roster markers** (existing, `question-check.ts`): roster name words become
   `⟨P#⟩`. The server resolves them for `find_student`; names and records go
   to the browser only.
2. **Value match** (new, `provider-egress-guard.ts`): the school's actual
   values, not patterns.
   - Every full name the school holds, in any case, order or accent, becomes a
     marker. This catches, for example, lower-case "grace hope", where both
     words are ordinary English words that the capitalisation rule lets
     through.
   - Any held admission number, email or phone number blocks the turn
     (`known-identifier`).
3. **Tool results** (new): school-typed labels, such as "Mrs Okafor's class",
   pass the value match and lose single roster words. A false positive only
   hides a label.
4. **The whole outgoing history**, including the task summary, passes the
   value match last.
5. **Speech** (voice): the text sent to OpenAI for speech passes the value
   match.
6. **Error reports**: Sentry drops the request body of every `/assistant/`
   route.

What none of this catches, and the terms say so: names not on the school's
records, nicknames, misspellings, descriptions, and anything spoken aloud,
because audio reaches the speech provider before any check.

## 6. Tests

| Spec | What it proves |
|---|---|
| `apps/api/src/__tests__/assistant-security.spec.ts` | 6 adversarial cases against PostgreSQL with a scripted, "injected" model: cross-school ids and runs; teacher permissions and scope; deactivation mid-turn; six approval-like tools; injection via text, history and a class label; local name resolution and label withholding; held identifiers blocking; no content in logs or ledgers |
| `apps/api/src/__tests__/assistant-governance.spec.ts` | 5 HTTP cases with enforcement on: classification guard, owner-proof routes and seeding; release incompleteness, non-attestable engineering checks, scope separation, LIVE blocked by the allowlist row; owner-only terms that never activate; fictional release cannot unlock a live school; kill switches (revoke, switch off, withdraw ending voice); RLS on terms events; append-only release log |
| `apps/api/src/__tests__/ai-release-requirements.spec.ts` | evidence conformance; LIVE cannot complete while AO-1 is pending; hashes, versions, scope and revocation ordering |
| `apps/api/src/common/ai/pii/provider-egress-guard.spec.ts` | value matching: case, order, accents, admission numbers, emails, phone formats, markers, redaction |
| `apps/api/src/observability/sentry-assistant-scrub.spec.ts` | Assistant bodies never reach Sentry |
| `apps/web/src/lib/assistant/ai-terms.spec.ts` | the terms card never implies AI is on |
| `packages/ai/evals/cases/assistant-orchestrator.ts` | pins: LIVE needs AO-1 and keeps it open while pending; FICTIONAL does not depend on it |
