# SchoolKit Assistant — AI security and data-protection report

Date: 2026-11-22. Scope: the SchoolKit Assistant's model orchestration
(Anthropic), realtime voice (OpenAI), their tools, database access, logging,
error reporting, permissions and activation. Other AI features (Smart Student
Import, assignment feedback, report comments, lesson plans, insights) are
governed by CLAUDE.md's allowlist and are listed in §2.4 for completeness only.

Every claim below is marked as one of:

- **Verified**: an automated test in this repository proves it. The test is named.
- **Reviewed**: established by reading the code. No dedicated test.
- **Not verified**: outside what this repository can show.

This report does not authorise any activation (§6).

## 1. Summary

| Area | Status |
|---|---|
| Super Admin alone switches AI understanding on, per school; owners cannot | **Verified** (`assistant-governance.spec.ts`, `assistant-activation.spec.ts`) |
| Release per data scope; immediate kill switch (revoke) | **Verified** (`assistant-governance.spec.ts`) |
| Fictional-data pilot testable without real data; cannot unlock a live school | **Verified** (`assistant-governance.spec.ts`) |
| Owner AI terms: versioned, hashed, owner-only, withdrawable, never activates | **Verified** (`assistant-governance.spec.ts`) |
| Tenant isolation of turns, tools, lookup, voice and governance records | **Verified** (`assistant-security.spec.ts`, `assistant-governance.spec.ts`, `assistant-voice.service.spec.ts`) |
| Model tool calls re-check active status, permissions and teacher scope | **Verified** (`assistant-security.spec.ts`, `tool-registry.spec.ts`) |
| No approval path via model or voice | **Verified** (`assistant-security.spec.ts`, `assistant-voice.service.spec.ts`) |
| Prompt injection gains no tool, record or tenant | **Verified** for the server boundary (`assistant-security.spec.ts`); the model can still write misleading *text* (§5) |
| Provider payloads minimised by value as well as pattern | **Verified** (`provider-egress-guard.spec.ts`, `assistant-security.spec.ts`) |
| No conversation content stored or logged; error reports drop Assistant bodies | **Verified** (`assistant-security.spec.ts`, `sentry-assistant-scrub.spec.ts`, voice spec) |
| LIVE (real children's data) release | **Blocked** (§6) |

## 2. Field-level data-flow inventory

### 2.1 Anthropic: `assistant-orchestrator` prompt

Endpoint: `POST https://api.anthropic.com/v1/messages` via `@anthropic-ai/sdk`
(`packages/ai/src/client.ts`, `PROVIDER_API_BASE_URL`). Model: `claude-haiku-4-5`
(`MODELS.HAIKU_4_5`). The call is stateless, with no prompt caching and no
`metadata.user_id` (**Reviewed**: no `cache_control` or `metadata` in the
client). One request per tool step, at most 6 steps and 24 000 input tokens
per turn.

| Field sent | Content | Personal data? | Minimisation |
|---|---|---|---|
| `system` | Fixed product instructions | No | Static |
| `tools` | 11 tool schemas | No | Static; no approval-like names (**Verified**) |
| User messages (current + ≤11 earlier, ≤1 000 chars each) | What staff typed, or the voice transcript | **Possible, incidental** | 1. Roster name words → `⟨P#⟩`. 2. Held full names (any case or order) → `⟨P#⟩`. 3. **Blocked**: emails, phones, 10–11-digit numbers, full dates, pasted rows, admission numbers and any held identifier (**Verified**). Residual in §5. |
| Earlier assistant replies (resent by the browser) | The model's own text | Possible only if the browser forges it | Same checks as user messages (**Reviewed**: `checkConversation` covers every message) |
| Task summary (appended) | Handles `t1`–`t9`, workflow, status, term label, class labels, counts, correction field names | No (labels typed by the school) | Passes the value match (**Verified**) |
| Tool results | Term and class labels; counts; statuses; student handles `s1`–`s9` with class labels; guide excerpts; send and issue counts | No names, contacts, money, ids or record contents by design (**Reviewed**: each tool's `outputFields` allowlist) | Value match plus roster-word withholding on every result (**Verified**: a class label carrying a staff surname is withheld) |
| HTTP headers | API key | No | Server only |

**Not sent** (**Verified**: `assistant-security.spec.ts` asserts absence from
everything the model saw):

- student, guardian and staff names as held;
- admission numbers;
- record ids (UUIDs) and school ids;
- attendance, results and summary contents;
- other schools' data.

Money amounts are also not sent (**Reviewed**: tools return counts only, and
`checkReply` strips figures from replies).

### 2.2 OpenAI Realtime: transcription session (voice)

The server calls `POST https://api.openai.com/v1/realtime/client_secrets`. It
sends only static session configuration: transcription model, language,
a vocabulary prompt of school words with no names, and turn detection. The
browser then connects to `https://api.openai.com/v1/realtime/calls` over
WebRTC, which is DTLS-SRTP encrypted.

| Data | To OpenAI? | Notes |
|---|---|---|
| **Raw microphone audio** while the session is open | **Yes: unredactable** | Anything said, including names, reaches OpenAI before any check. Accepted only through the release attestations. Capture starts only after the person's tap creates a session. |
| Transcript | Produced by OpenAI and returned to the browser | Then sent to SchoolKit as an ordinary turn and checked as in §2.1 |
| Ephemeral client secret | Issued by OpenAI | Valid to connect for ≤60 s; held in browser memory only |

### 2.3 OpenAI: speech (`POST https://api.openai.com/v1/audio/speech`)

| Field | Content | Minimisation |
|---|---|---|
| `input` | The assistant's checked reply, ≤600 chars | Markers spoken as "that person"; handles removed; value match applied (**Verified** for the guard; wiring **Reviewed**); HMAC-bound to text the server wrote (**Verified**) |
| `model`, `voice`, `instructions` | Static | — |

### 2.4 Other AI features (outside this scope, for completeness)

| Prompt | Sends | Governance |
|---|---|---|
| `student-list-extraction` | Register photos (student PII is the payload) | CLAUDE.md allowlist row 1 |
| `assignment-feedback` | A child's typed answer, with names removed | Allowlist row 2 |
| `help-assistant` | Staff questions | Allowlist row 3; pilot not active |
| `billing-run-planner`, report comments, lesson plans, insights, parent summaries | Opaque ids and class-level context only | CLAUDE.md AI rules |

## 3. What SchoolKit keeps

| Store | Content | Content-free? |
|---|---|---|
| `ai_generations` | Prompt name and version, model, tokens, latency, cost, status | **Verified** no text (`assistant-security.spec.ts`) |
| `ai_interaction_logs` | `{ feature }` only | **Verified** |
| `assistant_voice_sessions` | Ids, timestamps, counts, billed seconds, last 20 client turn UUIDs | **Verified** (voice spec) |
| Billing runs, workflow proposals, reminder campaigns | Structured workflow data the person prepared, under RLS; proposal rows cleared on completion or expiry | Existing modules |
| `school_ai_terms_events` | Action, version, wording hash, user, time, IP | Consent evidence |
| `ai_release_events` | Scope, action, requirement, hash, operator reference, admin user id | Platform evidence |
| `audit_logs` | Action names and ids; no text | Existing |
| Application logs | School id, outcome, tool **names**, counts | **Verified** no question or reply text |
| Sentry | Assistant request bodies dropped | **Verified** (`sentry-assistant-scrub.spec.ts`) |
| Browser | Conversation in memory only; cleared on sign-out, account change and 15 minutes idle | **Reviewed** (`apps/web/src/lib/assistant`) |

### Provider retention

Verified from the providers' published documentation on 2026-11-22, and for
Anthropic from the owner's console evidence of 2026-11-11.

- **Anthropic API:** inputs and outputs are deleted within 30 days and are not
  used for training. Zero data retention is available on request and is **not
  enabled**. `claude-haiku-4-5` is eligible for it; the newer Fable and Mythos
  models are not.
- **OpenAI API:** abuse-monitoring logs are kept for up to 30 days and not used
  for training. `/v1/realtime` keeps no application state and is eligible for
  zero data retention, which needs OpenAI's approval and is **not enabled**.
- Whether the *production* keys' organisations match these defaults is
  attestation `att.provider-retention`. It is **not verified** here.

Deletion: SchoolKit cannot delete what a provider has already received; it
expires under the provider's retention. Deleting a school removes its voice
sessions and terms events: the deletion is catalog-driven over `school_id`,
**Reviewed**. Release events are platform records and are kept.

## 4. Controls by threat

| Threat | Control | Evidence |
|---|---|---|
| Cross-tenant read via forged ids in task states, student refs or tool arguments | `TurnState` drops ids not in the school's structure; `StudentLookupService.describe` re-checks tenant and scope; services use `withTenant`; RLS | **Verified** |
| Model calls a tool the person may not use | `ToolRegistry.execute` re-reads `is_active` and permissions every call; services keep role and teacher scope | **Verified** |
| Model or speech approves or executes | No approval tool; registry refuses approval-like names; spoken consent is deflected without a model call | **Verified** |
| Prompt injection (text, history, tool results) | The above; tool arguments validated; injected labels pass through the value match like any label | **Verified** for actions and data; residual in §5 |
| Identifier leaves via an unanticipated route | Value match on messages, tool results, history and speech | **Verified** |
| Conversation in logs or error reports | Name-only logging; Sentry drops `/assistant/` bodies | **Verified** |
| Activation by a school | Feature, classification, seed and release routes are behind `PlatformAdminGuard`; owners only accept terms, which activates nothing | **Verified** |
| Stale activation after a switch-off | Model-routing switch read uncached each turn; release and terms read each turn | **Verified** |
| Tampering with release evidence | `UPDATE` and `DELETE` revoked for `app_user` on `ai_release_events`; `UPDATE` revoked on terms events | **Verified** |
| Provider credential exposure | Server keys only in API env (`API_ENV_FILE`); browser gets a ≤60 s ephemeral voice secret; Anthropic key never leaves the server | **Reviewed** |

### Encryption

- **In transit:** HTTPS to both providers. WebRTC media is DTLS-SRTP. Staff
  traffic reaches the API over HTTPS through Cloudflare and Caddy
  (`infra/vps/Caddyfile`). **Reviewed.**
- **At rest:** PostgreSQL and the VPS disk are **not verified**: this
  repository cannot show whether the volume is encrypted. BVN fields use
  pgcrypto, but the Assistant stores no content that needs it.

## 5. Remaining risks (accepted only through the release attestations)

1. **Free text.** Names not on the school's records, nicknames, misspellings,
   descriptions ("the boy whose father died"), health or family detail, and
   short numbers can reach Anthropic. Detection is by value and pattern, never
   complete.
2. **Voice audio is unredactable.** Anything spoken reaches OpenAI. The pilot
   relies on fictional data and briefed testers.
3. **Withholding false positives.** A class or term label that is also a name
   on the roster is hidden from the model. This degrades answers, not safety.
4. **Misleading model text.** An injected or wrong model can *say* something
   untrue, for example "it's approved". It cannot *do* anything: cards show the
   server's state, and approval is a separate control.
5. **Voice provider specifics.** It is not verified whether a browser can widen
   a transcription session with `session.update`, or whether the server can
   hang up an already-connected call (`docs/modules/assistant-voice.md` §8).
   Barge-in aborts only reach the API process serving the request.
6. **Encryption at rest** of the VPS database volume is not verified.
7. **No console UI** for release attestations: the API is used directly
   (documented). The AI terms card exists.
8. **Fictional tenant discipline.** Nothing technical stops a tester typing
   real data into the fictional school. That is attestation
   `att.fictional.staff-briefed`, plus the release stop conditions.

## 6. Release blockers

**FICTIONAL (the Virgo Fidelis pilot tenant).** No engineering blockers. A
person must record three attestations, then authorise. Next, the pilot school's
owner accepts the terms and the platform admin switches the pilot school on
(`docs/modules/assistant-ai-governance.md` §3).

**LIVE (any school holding real children's records), blocked on:**

1. `live.allowlist-row`: AO-1. The owner adds the `assistant-orchestrator` row
   to CLAUDE.md and sets `ASSISTANT_ORCHESTRATOR_APPROVAL = "approved"` in one
   reviewed change.
2. `att.live.counsel`: a written conclusion on lawful basis, roles, transfer,
   children's data and the DPIA (`docs/reviews/virgo-assistant-pilot-signoff-register.md`).
3. `att.live.terms-and-notices`: counsel-approved AI terms wording (bump
   `SCHOOL_AI_TERMS_VERSION` if it changes), the published privacy policy, and
   the parent notice or consent decision.
4. `att.provider-retention`: for the production keys.
5. `att.live.release-evals`: live evaluations passing on the release commit.

None of these was marked complete by this change.
