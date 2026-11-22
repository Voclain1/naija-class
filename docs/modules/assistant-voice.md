# SchoolKit Assistant — realtime voice (backend, Sprint 1)

Status: **built, off by default.** Super Admin activation is the voice-specific rollout control; provider and model-routing readiness remain separate prerequisites. Issue #554.
Contract version **1** (`VOICE_CONTRACT_VERSION` in `@school-kit/types`).

Voice is a second **interface** to the SchoolKit Assistant described in
`docs/modules/assistant-workspace.md`, never a second agent. Every spoken
request becomes text and goes through `AssistantOrchestratorService.turn`,
the same call the chat makes, with the same detectors, roster-name redaction,
scoped `ToolRegistry`, AI budget and `ai_generations` ledger. Voice adds no
tool, no prompt and no approval path.

## 1. What works today, and what does not

Audit of the Assistant this builds on (2026-11-21):

| Capability | State | Voice inherits it? |
|---|---|---|
| Panel, task cards, deterministic router (`assistant-workspace`) | Built, off by default | Required (`WORKSPACE_OFF`) |
| Model orchestration (`assistant-orchestrator` prompt, `assistant-model-routing`) | Built, **approval pending**, refused in production | Required (`MODEL_ROUTING_UNAVAILABLE`) |
| Term invoices: prepare preview → approve on card | Built (`assistant-billing`) | Yes, prepare only |
| Fee reminder campaigns: plan + preview → confirm on card | Built (`reminder-campaigns`) | Yes, plan only |
| Student intake: open card with class/term | Built (`student-intake`) | Yes, opens card only |
| Student corrections: choose fields | Built (`student-corrections`) | Yes, chooses fields only |
| Named student lookup, record sections (summary/attendance/results) | Built | Yes, names to the browser only |
| Guide search | Built | Yes |
| Approval of anything | **Card only** (`BillingRunsService.approve`, etc.) | **Never by voice** |
| Arbitrary school actions (delete, grades, messaging, money) | Not supported | Not supported |

Voice therefore cannot do anything the chat cannot, and today, in production,
neither can do anything model-backed, because the orchestrator's approval is
pending.

## 2. Architecture

```
 mic ──WebRTC (audio)──▶ speech provider: TRANSCRIPTION SESSION ONLY
  ▲                        │ transcript + turn events (data channel "oai-events")
  │                        ▼
  │                     browser ──POST /assistant/voice/sessions/:id/turns──▶ API
  │                                                    │
  │                                                    ▼
  │                                  AssistantOrchestratorService.turn  (unchanged)
  │                                  detectors → ⟨P1⟩ redaction → tool loop → checked reply
  │                                                    │
  └──audio stream── API ◀── POST …/speech (HMAC-bound server text) ── reply + speech token
```

**Why cascaded (speech-to-text → SchoolKit's model → text-to-speech) and not
a speech-to-speech realtime model.** A speech-to-speech model (OpenAI
Realtime `gpt-realtime`, Gemini Live) would itself decide what to do and what
to say. That would mean a second brain with its own tool calling, receiving
unredacted text, and able to *say* things ("approved", a figure) that no
server action produced. The issue's rules (shared intelligence, preserve
redaction, distinguish audio from authoritative results, no new approval
shortcut) are only provable when the provider is restricted to transcription
and the voice reads only server-written text. The cost is latency: one model
turn (typically 1–5 s with tools) sits between end-of-speech and the reply.
Streaming partial transcripts, server VAD and streamed speech keep the rest
of the loop fast. A speech-to-speech design remains possible later only as a
"voice" for server text, with its own sign-off.

**Barge-in.** The provider's VAD emits `speech.started` while the assistant
is speaking or thinking. The browser stops playback, aborts its speech/turn
fetch and calls `POST …/interrupt`; the server aborts any speech stream it is
serving for the session and marks an in-flight turn interrupted (its speech
is then withheld). Cards a cancelled turn prepared are previews only.

**Turn detection.** Server VAD (`server_vad`, 700 ms silence, configurable)
by default; `semantic_vad` available by setting.

### Provider evaluation

| Option | Two-way streaming / WebRTC | Short-lived browser credential | Server tool calling kept in SchoolKit | Barge-in | Nigerian English | Notes |
|---|---|---|---|---|---|---|
| **OpenAI Realtime, transcription session + Audio speech** (chosen) | WebRTC direct from browser | Yes (`/realtime/client_secrets`, TTL set per session) | Yes: the session is transcription-only | Server/semantic VAD events | General multilingual ASR; vocabulary prompt; **unmeasured** for Nigerian English | One vendor for STT and TTS; billed per audio minute / per character or audio token |
| OpenAI Realtime speech-to-speech | WebRTC | Yes | No: the model would hold the tools | Native | as above | Rejected: second brain (see above) |
| Deepgram (Nova streaming STT + Aura TTS) | WebSocket from browser | Temporary keys | Yes | VAD/endpointing events | Strong accent coverage claimed; unmeasured here | Good alternative behind the same port |
| Google Cloud Speech / Gemini Live | gRPC/WebSocket (WebRTC via own stack) | Varies | Live: no | Yes | Has `en-NG` locale (Speech-to-Text) | Worth a bake-off on Nigerian English |
| Azure Speech | WebSocket SDK | Auth tokens | Yes | Yes | Has `en-NG` locale | Heavier SDK |
| Browser `SpeechRecognition` | n/a | n/a | n/a | No | Poor, browser-dependent, may route audio to the browser vendor | **Not used**: it is not a realtime agent and would silently degrade |

The provider sits behind `VoiceProviderPort`
(`apps/api/src/modules/assistant-voice/voice-provider.port.ts`); switching to
Deepgram or Google is one adapter file plus a `VOICE_PROVIDER` value. **A
recorded Nigerian English bake-off (accents across regions, classroom noise,
code-switching with Pidgin, Yoruba, Igbo and Hausa names) should precede
go-live**; nothing in this build measures accuracy.

## 3. Endpoints

All under `/api/v1`, all behind `AuthGuard` (staff session cookie or Bearer).
School and user always come from the session; bodies are `.strict()` Zod
schemas, so an extra `schoolId`/`userId` is a 400. Transcripts and replies
travel in POST bodies only, never in URLs.

| Method & path | Body | Answer | Throttle |
|---|---|---|---|
| `GET /assistant/voice/capabilities` | — | `VoiceCapabilitiesDto` | default |
| `POST /assistant/voice/sessions` | `{ activation: "user-gesture" }` | 201 `VoiceSessionStartDto` | 6/min |
| `GET /assistant/voice/sessions/:id` | — | `VoiceSessionDto` | default |
| `POST /assistant/voice/sessions/:id/credentials` | `{}` | `{ session, credential }` (reconnect) | 10/min |
| `POST /assistant/voice/sessions/:id/heartbeat` | `{}` | `VoiceSessionDto` | 30/min |
| `POST /assistant/voice/sessions/:id/turns` | `VoiceTurnInput` | `VoiceTurnDto` | 20/min (same as chat) |
| `POST /assistant/voice/sessions/:id/speech` | `{ turnId, token, text }` | streamed `audio/mpeg` | 30/min |
| `POST /assistant/voice/sessions/:id/interrupt` | `{ turnId?, at: "thinking" \| "speaking" }` | `VoiceSessionDto` | 60/min |
| `POST /assistant/voice/sessions/:id/end` | `{}` | `VoiceSessionDto` (idempotent) | default |

Platform admin (behind `PlatformAdminGuard`):

| Method & path | Body | Answer |
|---|---|---|
| `PATCH /platform-admin/schools/:schoolId/features` | `{ key: "assistant-voice", enabled }` | existing route; switching on is controlled by Super Admin; actual sessions still require the provider, workspace, model routing, and budgets |
| `GET /platform-admin/schools/:schoolId/voice` | — | `PlatformAdminVoiceStatusDto`: switch, working, every blocker, approval, provider, budget, this month's seconds, sessions, estimated cost, limits |
| `PATCH /platform-admin/schools/:schoolId/voice-budget` | `{ monthlySecondsBudget: number \| null }` | audited (`platform_admin.schools.set-voice-budget`); `null` = default, `0` = none |
| `POST /platform-admin/schools/:schoolId/voice/end-sessions` | — | `{ schoolId, ended }`, audited (`platform_admin.schools.end-voice-sessions`) |

The generic features section of the super-admin console already lists
`assistant-voice` (it renders every `FEATURE_KEYS` entry), so no UI change is
needed for the switch itself.

## 4. Frontend integration contract (for the chat-first UI, PR #552)

Types: `packages/types/src/assistant/voice.ts`, exported from
`@school-kit/types`. Everything below is version 1.

### 4.1 Lifecycle

1. **Before showing the mic button**, `GET …/capabilities`. Show voice only
   when `available` is true and the browser has `RTCPeerConnection` and
   `navigator.mediaDevices.getUserMedia`. Otherwise keep the text composer
   (it is the fallback; there is no degraded speech mode). Show the first
   blocker's text (`VOICE_BLOCKER_TEXT`) only to people it helps.
2. **On the person's tap**, in that click handler: `POST …/sessions` with
   `{ activation: "user-gesture" }`. Only after it succeeds call
   `getUserMedia({ audio: true })`. No audio is captured before that tap.
3. **Connect** (WebRTC):
   ```ts
   const pc = new RTCPeerConnection();
   const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
   pc.addTrack(mic.getTracks()[0], mic);
   const dc = pc.createDataChannel(credential.dataChannel); // "oai-events"
   dc.onmessage = (m) => handle(normaliseVoiceProviderEvent(JSON.parse(m.data)));
   await pc.setLocalDescription(await pc.createOffer());
   const res = await fetch(credential.connectUrl, {
     method: "POST",
     body: pc.localDescription!.sdp,
     headers: { Authorization: `Bearer ${credential.clientSecret}`, "Content-Type": "application/sdp" },
   });
   await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
   ```
   Keep `clientSecret` in memory only; it is valid to *connect* until
   `credential.expiresAt` (≤ 60 s). Never put it in storage, URLs, logs or
   analytics.
4. **Heartbeat** every `limits.heartbeatSeconds` (`POST …/heartbeat`). A
   session with no heartbeat or turn for `limits.idleTimeoutSeconds` ends
   (`IDLE`).
5. **Turns.** On `transcript.final`, build exactly the chat's turn body
   (messages it holds, task states, student refs) with the transcript as the
   newest user message, and `POST …/turns`:
   ```json
   { "turnId": "<new uuid>", "inputMode": "voice",
     "turn": { "messages": [...], "tasks": [...], "students": [...] } }
   ```
   Apply `turn.actions` to the cards **exactly as chat does**. If
   `speech` is not null, `POST …/speech` with `{ turnId, token, text }` and
   play the `audio/mpeg` stream (e.g. `MediaSource` or a blob URL). Show
   `turn.reply` as the assistant's message; the spoken text may be shorter.
6. **Typing during a voice session** uses the same `…/turns` route with
   `inputMode: "text"` (the reply can be spoken), or the chat's own
   `/assistant/workspace/turn` (silent). Both keep one conversation in browser
   memory. Switching back to voice needs nothing: the next transcript joins the
   same messages array.
7. **End** on the End button, on sign-out, on account/school change and on
   unload (`fetch(..., { method: "POST", keepalive: true })`). Close the peer
   connection and stop the mic track **first**, so audio stops immediately.

### 4.2 States the UI must show

`VOICE_UI_STATES`: `idle`, `connecting`, `listening`, `user-speaking`,
`thinking`, `speaking`, `muted`, `reconnecting`, `ended`. **Muted** disables
the mic track (`track.enabled = false`) and must be visible; **End** must be
always reachable.

### 4.3 Provider events → UI

Feed every data-channel message through `normaliseVoiceProviderEvent`:

| Event | UI |
|---|---|
| `speech.started` | `user-speaking`; **if `speaking` or `thinking`: barge-in** (stop audio, abort fetches, `POST …/interrupt { turnId, at }`) |
| `speech.stopped` | waiting for the final transcript |
| `transcript.delta` | live caption for `itemId` |
| `transcript.final` | finalise caption, send the turn, go `thinking` |
| `transcript.failed` | "I didn't catch that", stay `listening` |
| `provider.error` | reconnect once via `…/credentials`; then fall back to text |

### 4.4 Approval and task cards

* `approvalRequiresCard: true` means the card shows a reviewable preview.
  Approval is the card's own control, calling the existing approval endpoint.
  **Never wire a spoken phrase to an approval.**
* `spokenApprovalDeflected: true`: the person said "yes", "approve it", "send
  them"…; nothing ran and no model was called. Highlight the card's Approve
  button.
* `interrupted: true`: discard the reply; keep any card (it is a preview).

### 4.5 Errors (standard `{ error: { code, message, details } }`)

| HTTP | `error.code` | Meaning → UI |
|---|---|---|
| 401 | `UNAUTHORIZED`, `USER_INACTIVE`, … | existing handler (to sign-in); session already ended `REVOKED` |
| 403 | `VOICE_UNAVAILABLE` | `details.blockers`; `details.endReason: "REVOKED"` when a live session was ended by a permission or switch change → end voice, keep text |
| 403 | `VOICE_SPEECH_TOKEN_INVALID` | do not speak; text is on screen |
| 404 | `NOT_FOUND` (`details.code: "VOICE_SESSION_NOT_FOUND"`) | not yours or unknown → start a new session |
| 409 | `VOICE_SESSION_ENDED` | `details.endReason` → show `VOICE_END_REASON_TEXT` |
| 409 | `VOICE_TURN_REPLAYED` | a duplicate send; ignore |
| 429 | `VOICE_CONCURRENCY_LIMIT`, `VOICE_BUDGET_EXHAUSTED`, `VOICE_CREDENTIAL_LIMIT`, `VOICE_SPEECH_LIMIT` | fall back to text with the message |
| 429 | throttler | back off |
| 502 | `VOICE_PROVIDER_FAILED` | fall back to text |

The turn's own outcomes (`budget_exhausted`, `rate_limited`, `blocked`,
`unavailable`, `incomplete`) arrive inside a 200 exactly as in chat.

### 4.6 Usage

Every session DTO carries `usage` (`secondsElapsed`, `secondsRemaining`,
`turns`, `interruptions`, `speechCharactersUsed/Remaining`,
`credentialsIssued`, `estimatedCostMicroUsd`) and `expiresAt`. Show a gentle
"x minutes left" near the end; the cost estimate is for the operator, not for
schools.

## 5. Security and privacy

* **Credentials.** The server key never leaves the API. The browser gets a
  per-session ephemeral secret for a *transcription* session, valid to connect
  for ≤ 60 s; reconnects mint a new one (capped per session).
* **Identity and tenancy.** Sessions are looked up by `(id, school_id,
  user_id)` under RLS (`assistant_voice_sessions`, FORCE RLS). Another
  person's or school's id is 404. Every request re-reads the person and the
  switches (`AssistantWorkspaceService.capabilities`) and ends the session
  `REVOKED` when anything that allowed it is gone.
* **Approval.** No tool can approve (the orchestrator registry refuses
  approval-like names). Spoken consent is answered with "tap Approve on the
  card", without a model call. Speech is HMAC-bound to text the server wrote
  for that session and turn (`voice-speech.ts`), so the voice cannot be made
  to say "approved" or any text the server did not produce.
* **Redaction.** Unchanged and inherited: the transcript passes the same
  detectors, and roster names become `⟨P1⟩` before the model. The speech
  provider receives the model's checked reply (no names: the model never had
  them; markers are spoken as "that person").
* **What the speech provider receives that the model does not: the raw
  audio.** Spoken names, numbers or contact details reach the provider
  before any detector. This is why voice carries its own approval.
* **Storage.** `assistant_voice_sessions` holds ids, timestamps, counts,
  billed seconds and the last 20 client turn UUIDs (replay protection). No
  audio, transcript, reply text or credential is stored, queued, cached or
  logged anywhere. Logs carry ids, counts and outcome names.
* **Replay.** A `turnId` is accepted once per session (atomic SQL check).
* **Microphone.** The session needs the `activation: "user-gesture"` literal;
  the browser must not open the mic before the session exists.

## 6. Usage and cost controls

* **Unit:** seconds of open session per school per UTC month
  (`schools.voice_monthly_seconds_budget`, default
  `VOICE_DEFAULT_MONTHLY_SECONDS` = 3600). Audio flows browser → provider, so
  the server bills wall-clock time, an upper bound of transcription billing.
* **Reservation:** a session reserves its whole allowance at start
  (`expiresAt` = min(max length, school's remaining seconds)) under a
  per-school advisory lock, so concurrent sessions cannot overspend; it is
  settled to the real duration when it ends (idle sessions are billed only to
  the idle limit).
* **Caps:** max session length (600 s), idle timeout (120 s), one live
  session per person (a new one supersedes), per-school concurrency (3),
  reconnect credentials per session (6), spoken characters per session
  (12 000; refunded when synthesis fails).
* **AI budget is not bypassed:** a school whose AI tokens are used up cannot
  start voice (`AI_BUDGET_EXHAUSTED`), and every turn reserves tokens through
  `AiGenerationService` exactly as chat does. Voice turns share the chat's
  per-person throttle (20/min).
* **Estimates** (`estimated_cost_micro_usd`): `VOICE_COST_MICRO_USD_PER_SECOND`
  (default 100 ≈ US$0.006/min, the order of a realtime transcription model)
  and `VOICE_COST_MICRO_USD_PER_SPEECH_CHAR` (default 15 ≈ US$15 per million
  characters). **These are placeholders to be confirmed against the
  provider's current price list; nothing here claims zero cost.** At the
  defaults a school using its full hour costs roughly US$0.36 in
  transcription plus speech (≈ US$0.10–0.20 for typical reply lengths), plus
  the model turns already counted in AI tokens.
* **Billing model of the new vendor:** OpenAI usage-based, pay-as-you-go
  against an organisation API key; needs a project with a spending limit, and
  the API data-processing terms reviewed (zero data retention eligibility, if
  required).

## 7. Configuration

`.env.example` lists every variable (`VOICE_*`). Values are clamped
(`voice.config.ts`). `VOICE_PROVIDER` empty means no provider: voice reports
`PROVIDER_NOT_CONFIGURED` and fails closed. `FEATURES_DISABLED=assistant-voice`
is the immediate platform-wide kill.

## 8. Verify before go-live (not verifiable from the build environment)

The build container could not reach the provider's documentation or API, so
these are written from the provider's published Realtime GA design and must
be checked against the live reference and a real key:

1. `POST /v1/realtime/client_secrets` body: `expires_after`,
   `session.type: "transcription"`, `session.audio.input.{format,
   transcription, turn_detection, noise_reduction}`; response `value`,
   `expires_at` (`openai-voice.provider.ts`).
2. WebRTC SDP exchange at `/v1/realtime/calls` with the ephemeral key, and
   the data-channel event names mapped in `normaliseVoiceProviderEvent`.
3. Whether a client can widen a transcription session with `session.update`
   (e.g. switch to a speech-to-speech model). If it can, add a server-side
   sideband monitor or move to a server-relayed audio path.
4. Whether the provider ends the WebRTC call when the ephemeral secret
   expires, and its own maximum session length. Today the server ends *its*
   session (turns and speech are refused), but an already-connected provider
   call could keep transcribing until the browser closes it or the provider's
   limit is reached. A server-side hang-up via the provider's call id would
   close this gap.
5. `/v1/audio/speech` with `gpt-4o-mini-tts`, `response_format: "mp3"`,
   `instructions`, streamed.
6. Prices for the configured models, to replace the cost placeholders.
7. Nigerian English accuracy bake-off (§2).

## 9. Activation gates (all required)

1. **Super Admin school switch** controls voice access (off by default). The legacy `ASSISTANT_VOICE_APPROVAL` field is informational and no longer a runtime veto.
2. **Everything the orchestrator needs**, including its own pending approval.
3. The school's **`assistant-voice`** switch (platform admin only; off by
   default and for new schools) and no `FEATURES_DISABLED` kill.
4. A configured provider and key.
5. Voice seconds and AI tokens remaining.

### Proposed CLAUDE.md row (for owner review; NOT APPROVED)

> **`assistant-voice` (audio to the speech provider)** — SchoolKit Assistant
> voice (`docs/modules/assistant-voice.md`). **Not the payload — incidental.**
> The staff member's voice is sent to the speech provider to be transcribed;
> the transcript then goes through `assistant-orchestrator` under that
> prompt's own row. Spoken personal data reaches the speech provider before
> any detector; staff are asked not to say any, and a standing notice says
> so. Mitigated: transcription-only provider session (no reasoning, no
> tools), per-session ephemeral credentials, no audio or transcript stored by
> SchoolKit, server-written speech only. Optional at every level: the
> platform's switch, the school's switch (off by default), and the staff
> member's tap. Requires the provider's data-processing terms reviewed and
> the orchestrator's row approved first.

Provider privacy/data-processing review remains an operational prerequisite before real audio is sent to the provider; the voice-specific code gate is no longer used for school activation.

## 10. Tests

No test calls a provider or a model; both are fakes.

* `apps/api/src/modules/assistant-voice/voice-units.spec.ts` (41): spoken
  approval detection (deflects consent, passes real requests), speech token
  (session/turn/text/expiry/key binding), speakable text (no markers or
  handles, approval nudge, blocked categories only), config clamps, gate
  order, production approval, the OpenAI adapter's wire shape against a fake
  fetch (transcription-only, no provider error text kept), event normaliser.
* `apps/api/src/modules/assistant-voice/assistant-voice.service.spec.ts` (19,
  PostgreSQL as `app_user`, real orchestrator, billing and detectors,
  scripted model): off by default; fails closed without provider, model
  routing, panel or AI budget; platform kill; a spoken request prepares a
  preview through the chat's own tools and issues nothing; roster names
  redacted before the model; spoken "yes/approve/send them" approves nothing
  and calls no model, typed "yes" behaves as chat; replay (including
  concurrent duplicates); tenant and person isolation, including a forged
  context; revocation by deactivation and by switch changes; idle and expiry
  billing; supersede, per-school cap (including simultaneous starts); budget
  reservation and settlement; reconnect cap; speech token forgery, character
  cap and refund; barge-in (interrupt and client abort); interrupt while
  thinking; provider failure at start and reconnect; idempotent end and
  admin end-all; no transcript, reply or credential in the row or the logs.
* `apps/api/src/__tests__/assistant-voice-http.spec.ts` (5, real guards and
  filter): 401 on every route; strict bodies (no identity in the body, the
  activation literal); start → turn → streamed speech → end; cross-school
  404; forged speech 403; replay 409; platform-admin status, audited budget,
  audited end-all, staff refused; production refusal of voice and of
  switching it on.

**Not tested here (needs credentials and a browser):** a real WebRTC call,
real transcription quality, real speech playback, provider-side session
limits. These are the go-live checks in §8.
