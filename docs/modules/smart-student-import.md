# Smart Student Import — camera-captured student lists (plan-first)

**Status: BUILT (2026-08-20). All decisions approved by Arinzechukwu the same
day; D1 and D3 carried explicit sign-off before any code was written.**

Drafted 2026-08-20 as a plan-first, against the live repo and Anthropic's
published vision documentation (fetched 2026-08-20), not from memory. The
decisions below are recorded as approved, with an implementation log at §7.

Approved as drafted: every technical finding, D2, D4, D5, D6, model choice
(Sonnet 5), and the `aiExtracted` provenance flag. Two carried conditions:

- **D1** — approved, with the requirement that the carve-out be an explicit,
  named PER-PROMPT allowlist (one prompt, this feature only), never a broad
  category a future feature could silently inherit. Implemented that way and
  pinned by an eval; see §7.
- **D3** — approved as **Option A, never persisted**. Reasoning recorded at
  sign-off: every alternative introduces a genuinely new class of unprotected
  PII artifact, and Option B's "no lifecycle rule, needs a sweeper that tends
  not to get written" is a foreseeable failure mode given this project's
  history rather than a hypothetical. The synchronous-processing cost is real
  but bounded and communicable; the alternative risks are not. **Revisit only
  if real-world timing data proves it unworkable — not before.**

---

## 0. What this is

A school admin photographs a handwritten or printed student list with their
phone camera. The model extracts and maps the information — names, gender,
date of birth, class, parent/guardian details — to the fields of a bulk
student registration. **The admin reviews and edits every extracted record
before anything is written.** Nothing saves automatically.

This is the first vision-capable feature in the project. Every prior AI
feature (slices 2–5, 8) is text-in / text-out.

---

## 1. Where it fits

**Not Phase 5, not Phase 7.** Phase 5 is declared complete (slices 1–5 + 8,
all shipped). Phase 7 (RAG + tutor) is explicitly held pending an embeddings
vendor decision, and this feature has no dependency on either.

Per `CLAUDE.md`'s own convention for "work that isn't a numbered Phase"
(established by the admin dashboard rebuild), this gets:

- its own module doc — this file;
- its own permission constant, `SMART_IMPORT_PERMISSIONS`, spliced into
  `ALL_PERMISSIONS` rather than force-fit into `PHASE_5_PERMISSIONS`.

`ARCHITECTURE.md` §219 already anticipates the neighbourhood — "AI hooks —
duplicate detection on bulk import, OCR on uploaded birth certs" — so this is
a named-but-unscoped idea being scoped, not a new direction.

---

## 2. Model / API capability — CONFIRMED, with one real gap

### What already works

| Question | Answer | Evidence |
|---|---|---|
| Does the API support image input? | Yes | Vision docs — `image` content blocks, three source types (base64, url, file_id) |
| Does the installed SDK support it? | Yes | `@anthropic-ai/sdk@0.116.0` — `ImageBlockParam` with `source: Base64ImageSource \| URLImageSource` in the non-beta `messages` namespace |
| Do our models support vision? | Yes | Both `claude-haiku-4-5` and `claude-sonnet-5` accept images |
| Does the Files API `file_id` source work? | **Not in the non-beta path on 0.116.0** | `FileImageSource` exists only as `BetaFileImageSource`. Irrelevant to us — see D3, we send base64 once and never reuse |

### The gap: `AnthropicPort` is text-only by construction

`packages/ai/src/client.ts` defines:

```ts
export interface AiCallRequest {
  readonly userContent: string;   // <- a string, not a content-block array
}
```

and builds `messages: [{ role: "user", content: req.userContent }]`. There is
no way to attach an image without widening this contract. **This is new
plumbing, not a drop-in.** It is, however, small and confined to the seam —
which is exactly what the seam exists for.

Proposed widening (see D2 for why this shape):

```ts
readonly images?: readonly {
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly base64: string;
  readonly widthPx: number;    // required — feeds the token estimate
  readonly heightPx: number;
}[];
```

Images go **before** the text block in the content array. Anthropic's docs are
explicit that image-then-text outperforms text-then-image.

### Resolution tiers — this is the model-choice argument

Claude views images in 28×28-pixel patches. An image costs
`⌈width/28⌉ × ⌈height/28⌉` visual tokens, capped per tier:

| Tier | Models | Max long edge | Max visual tokens |
|---|---|---|---|
| High-resolution | Claude 4.7 and later | 2576 px | 4784 |
| Standard | everything earlier | 1568 px | 1568 |

`claude-sonnet-5` is high-resolution. `claude-haiku-4-5` is standard.

A 12MP phone photo (4032×3024) of an A4 register downsizes to ~1456×819
(1560 visual tokens) on Haiku, versus ~2236×1677 (~4784 visual tokens) on
Sonnet 5 — **roughly three times the pixel detail**. On a densely-ruled
handwritten register that is the difference between reading a name and
guessing at it.

**Recommendation: `claude-sonnet-5`.** It is already in `MODELS`, already
priced in `MODEL_PRICING`, and needs no new price-table row or version bump.
`claude-opus-5` would need both and roughly doubles the cost for a
transcription task Sonnet 5's vision already handles well. This is a
deliberate departure from D7's "Haiku by default" — justified because D7's
argument is volume asymmetry, and this feature is low-volume (a handful of
scans during onboarding), quality-sensitive, and permanently-recorded. Same
shape of argument D7 already accepted for lesson plans.

### The reservation under-counts image tokens — a hard-rule regression

`AiGenerationService.estimateInputTokens()` is `chars/4 + 16`. It has no idea
an image is attached. Left alone, a scan would reserve ~200 tokens + the
prompt's `maxTokens` while actually consuming ~5,600 input tokens.

`settle()` reconciles to the truth, so the *ledger* stays correct and the
budget is not permanently mis-stated. But `CLAUDE.md`'s AI hard rule says
**"Per-school monthly token budget enforced before the call, not after"** —
and a school sitting at 1.99M/2M could fire a scan the reservation prices at
4,200 tokens and that actually costs ~10,400, overshooting the cap. Small in
absolute terms; a hard-rule regression in kind.

Fix, and it is cheap: `estimateInputTokens` grows an image-aware branch that
computes `min(⌈w/28⌉ × ⌈h/28⌉, tierCap(model))` per image, and the tier caps
live in `models.ts` next to the price table where the rest of the
model-dependent arithmetic already is. Must land in the same PR as the
`AiCallRequest` widening, not after.

---

## 3. Decisions

### D1 — This feature contradicts the PII hard rule as currently written. It needs an explicit amendment, not a quiet exception. **[APPROVED 2026-08-20 — allowlist form required]**

`CLAUDE.md`: *"Never send student PII (full name, address, DOB, contact info)
to the LLM. Use opaque IDs and class-level context (e.g. 'JSS2 student')
only."* `phase-5.md` §7 rule 3 restates it and the PII eval suite asserts it
mechanically.

**Sending full names, DOBs and parent phone numbers to the model is this
feature's entire function.** It cannot be built without breaking that rule as
worded. There is no clever framing that avoids this.

This must not ship as an undocumented exception. This project has already
lived through the `AIGeneration` / `AIInteractionLog` confusion — where
shipped code and the written rule disagreed and nobody could later tell which
was intended. The same failure mode is available here, and it is worse,
because the rule in question is about children's PII.

Proposed amendment, for sign-off:

> Never send student PII to the LLM **for derived features** — comments,
> summaries, insights, tutoring — where the PII adds nothing the feature
> needs and opaque IDs are strictly better. The exception is a feature whose
> function *is* transcription of a document the school already holds and
> already possesses the data in. Such features require explicit per-feature
> sign-off recorded in `CLAUDE.md`, and carry their own rule: the transcribed
> data is never retained by the model path beyond the single request, and the
> extraction never writes to a student record without human confirmation.

The PII eval suite then needs a per-prompt carve-out rather than a blanket
assertion — and the carve-out should be an explicit allowlist of one prompt
name, so a future prompt cannot inherit it silently.

**NDPR note:** `School.ndprConsent` exists on the schema. This is a new
*category* of processing (identity documents / registers photographed and
transmitted to a US processor), though not a new processor relationship —
slices 3–5 already send scores and attendance to Anthropic. Worth a
deliberate look before switching a school on; not a blocker to building.

### D2 — Reuse `AiGenerationService`. Add no gating of any kind. **[recommended, low risk]**

Routing the extraction through `AiGenerationService.generate()` inherits
every existing safeguard with zero new mechanism:

| Safeguard | Mechanism | Inherited? |
|---|---|---|
| Platform kill switch | `AI_ENABLED` env → `platformEnabled` → `AI_DISABLED_PLATFORM` | Yes, free |
| Per-school toggle | `School.aiEnabled` checked inside `reserve()` → `AI_DISABLED_SCHOOL` | Yes, free |
| Missing key fail-soft | `createAnthropicClient(null)` → `AI_NOT_CONFIGURED` | Yes, free |
| Monthly token budget | atomic conditional `UPDATE ai_budget_periods` → `AI_BUDGET_EXCEEDED` | Yes, free |
| Per-user daily call cap | 200/user/day → `AI_USER_RATE_LIMITED` | Yes, free |
| Ledger row every call | `settle()` always runs, success *or* failure | Yes, free |
| No LLM call inside a transaction | reserve → call → settle | Yes, free |
| Can't be bypassed | ESLint `no-restricted-imports` on `@anthropic-ai/sdk` | Yes, free |
| Platform-admin re-enable | `PATCH /platform-admin/schools/:schoolId/ai` | Yes, unchanged |

**Confirmed: no separate gating mechanism is needed, and none should be
added.** The only thing that does *not* come free is reservation accuracy —
see §2's last subsection, which is a fix to the shared estimator, not a
parallel gate.

A refusal (`stop_reason: "refusal"`) is already handled: recorded as
`success=false` with `errorMessage="stop_reason=refusal"`, budget released,
no crash. Anthropic's stated limitation is that Claude will not *name people
in images* — that is facial identification, not transcription of written
text, so a refusal is unlikely here. But it fails safe and is visible in the
ledger if it happens.

### D3 — Image retention. **[APPROVED 2026-08-20 — Option A, never persisted]**

**This was the most consequential open question in the feature, and it was
decided explicitly rather than by default.** The options are preserved below
as they were put, so a future reader can see what was weighed and not only
what was chosen.

A photographed handwritten register is qualitatively different from anything
this system stores today. It is **one artifact containing forty children's
names, dates of birth, class placement and parent phone numbers**, in a form
that is immediately human-readable with no database access, no query, and no
tenant context. Every existing PII store in this product is a row behind RLS.
This is a JPEG.

Three options, with the tradeoffs stated honestly rather than steered:

**Option A — process and discard. Never persisted. [RECOMMENDED DEFAULT]**

Multipart upload → Multer `memoryStorage` buffer (exactly what the CSV import
path already does) → base64 → `messages.create` → buffer is garbage-collected
when the request ends. No `StorageObjectKey` kind added, nothing in R2,
nothing on the filesystem driver, no lifecycle rule needed because there is
no object. Anthropic's documented behaviour closes the far end: image uploads
are ephemeral, deleted after processing, and not used for training.

- *Cost:* no re-run. A poor extraction means re-photographing, which is ten
  seconds of an admin's time.
- *Cost:* no audit artifact. You cannot later prove what the photo said —
  only what the admin confirmed. Arguably a feature.
- *Cost, and this one is real:* it forces **synchronous** processing. A
  queued BullMQ job needs the bytes to outlive the request, and that is a
  persistence decision by another name. A 40-row extraction at Sonnet 5 is
  plausibly 30–60s, which is long for a plain HTTP request. Mitigations: raise
  the timeout on this one route and stream a progress state to the client, or
  cap a single scan at one page (see D5). Both are fine; neither is free.

**Option A′ — Redis-buffered, 15-minute hard TTL.** A variant worth naming
rather than smuggling in under Option A: hold the base64 in Redis (already
provisioned) keyed by job id, TTL 15 minutes, so a BullMQ worker can pick it
up. This buys async processing and a re-run window. **It is still a copy at
rest**, for up to 15 minutes, and should be described that way in any
privacy-facing text — not as "we never store it."

**Option B — R2 object, deleted on commit or after 24h.** Enables re-run,
async processing, and an audit trail.

- *Cost:* forty children's PII in object storage. R2 has **no lifecycle rule
  configured today**, so the deletion is application code — meaning a crashed
  worker or an abandoned job leaks the object indefinitely unless a sweeper
  is also built. That sweeper is real work and is the kind of thing that
  quietly never gets written.

**Option C — retained for the life of the import job**, mirroring the
existing `import-source` CSV precedent (deleted only when the admin deletes
the job).

- *Cost:* highest, and the precedent is misleading. A source CSV is a file the
  school already emailed itself; a photographed register is an artifact this
  product created. Photos would accumulate with nothing sweeping them.

**DECIDED: Option A, never persisted.** Not A′ — the fallback was considered
and declined, so the 15-minute at-rest window does not exist and no
admin-facing copy needs to describe one. Synchronous extraction is the
accepted cost. Revisit only on real timing evidence.

### D4 — Human review is mandatory, and it terminates in the existing import pipeline. **[recommended]**

Direct application of D15 ("the approval gate is a separate endpoint and a
separate permission"), which exists for report comments for exactly this
reason.

- Extraction **never** writes to `students`. It writes a staged result.
- The admin reviews a grid, edits freely, and commits explicitly.
- The commit is a **separate endpoint** with a **separate permission**.

The reuse that makes this cheap: **the scan should terminate in an
`ImportJob`, not in a new commit path.** The `imports` module already has,
tested and in production: per-row validation, internal + external dedup,
case-insensitive class-arm resolution, `Student` + `Enrollment` creation in
one per-row transaction, a bad-rows CSV, an error report, an audit trail, and
a preview page.

Concretely: extraction produces the same parsed-row array the CSV parser
produces, stored as `previewSnapshot` on an `ImportJob` with a new
`ImportJobType` (or a source discriminator on `STUDENTS`). The **mapping step
is skipped** — the model already mapped the fields, which is the whole
feature — and preview → commit is unchanged. That is a genuinely small amount
of new code sitting on top of a large amount of proven code.

Permissions, mirroring the `.generate` / `.write` split §8 already chose for
report comments and for the same reason (one spends budget, one writes a
permanent record):

- `student.scan` — run an extraction (spends the school's AI budget)
- `student.import` — **reused unchanged** for the commit, because it *is* a
  student import

### D5 — One page per scan; multi-page is multiple scans. **[recommended]**

The API allows up to 100 images per request at our context size, but a
40-name page is already ~4,800 output tokens. Two pages doubles output,
doubles latency, and doubles the blast radius of one bad extraction. One
image per call keeps latency bounded (relevant under D3 Option A's
synchronous constraint), keeps each ledger row attributable to one page, and
lets the admin re-shoot a single bad page rather than the whole register.

A 400-student school does ten scans. That is fine — see §4, it is 5% of one
month's budget.

### D6 — The model must never guess, and must never "correct" a Nigerian name. **[recommended]**

Two distinct failure modes, both of which write permanent errors into a
child's record:

1. **Guessing an illegible field.** Structured output carries per-field
   nullability plus an explicit `unreadableFields: string[]` per row. The
   prompt rule is absolute: if a field cannot be read with confidence, return
   `null` and name it. Never infer, never interpolate from neighbouring rows,
   never invent an admission number.

2. **Normalising an unfamiliar name toward a familiar spelling.** This is the
   specific, predictable risk of this feature. "Chukwuemeka" silently
   rendered "Chukwueka", or "Adaeze" as "Adaeza", is a permanent record error
   that looks plausible enough to survive review. The prompt rule: transcribe
   exactly as written; where a letter is uncertain, mark the field low
   confidence rather than choosing the nearest familiar spelling. This
   deserves its own eval fixture set, not a line in a prompt.

UI consequence: fields returned null or low-confidence render amber in the
review grid with *"couldn't read — please fill in"*, and the existing row
validation already refuses to commit a row missing `admissionNumber`,
`firstName` or `lastName`. A partially-unreadable scan therefore degrades to
"most rows fine, four need typing" rather than failing wholesale — which is
the correct behaviour for a feature whose input quality is genuinely
uncontrollable.

---

## 4. Cost

Per scan, one 12MP phone photo of a 40-name A4 register, `claude-sonnet-5`
(high-resolution tier), priced at the **standard** $3 / $15 per MTok rate the
repo already encodes (`models.ts` deliberately encodes standard, not the
introductory rate, so the ledger over-estimates rather than under-estimates):

| Component | Tokens | Cost |
|---|---|---|
| Image (capped at tier max) | ~4,784 | $0.0144 |
| System prompt + instructions | ~800 | $0.0024 |
| Output — 40 rows × ~110 tokens | ~4,800 | $0.0720 |
| **Total** | **~10,400** | **~$0.089** |

**≈ 9 US cents per 40-student page**, i.e. about ₦0.14 per student at any
plausible rate. Output dominates, which is why page size (D5) matters more
than image resolution does.

Comparisons: `claude-haiku-4-5` at standard resolution would be ~$0.027/page
but with a third of the pixel detail on handwriting — the wrong trade.
`claude-opus-5` would be ~$0.15/page and needs a new `MODELS` entry plus a
`MODEL_PRICING` row and a `PRICE_TABLE_VERSION` bump.

**Budget fit.** The default cap is 2,000,000 tokens/school/month, enforced in
tokens (phase-5.md D3), input + output.

- ~10,400 tokens/scan → **~192 scans/month** before a school hits its cap.
- A school onboarding 400 students = 10 scans = ~104,000 tokens = **~5% of one
  month's budget**, ~$0.89 of platform cost.

**This is not a budget problem.** Onboarding is a one-time burst, and the
default cap absorbs it comfortably with room for the five existing text
features. No change to `DEFAULT_MONTHLY_TOKEN_BUDGET` is warranted. The real
budget risk is the *under-reservation* described in §2, not the spend.

The per-user daily cap of 200 calls also happens to bound this correctly: an
admin cannot scan more than 200 pages in a day, which is far beyond any real
onboarding.

---

## 5. Scope and honest time estimate

| Work | Estimate |
|---|---|
| Widen `AiCallRequest` for images; image-aware `estimateInputTokens`; tier caps in `models.ts` | 0.5 d |
| Prompt + structured-output schema + registry entry | 0.5 d |
| Eval fixtures — real photographed registers with hand-verified ground truth | 0.5 d *(excludes collecting the samples — see below)* |
| API: upload endpoint, extraction service, `ImportJob` bridge | 1.5 d |
| Web: camera capture, upload, review grid with per-field confidence, edit, commit | 2 d |
| Tests: service specs, PII eval carve-out, one E2E happy path | 1 d |
| Docs: this file finalised, `CLAUDE.md` amendment, permission wiring | 0.5 d |
| **Total** | **~6.5 d → call it 7–8 working days** |

**Two things that will make this slip, stated up front rather than
discovered:**

1. **Real handwriting samples are a prerequisite, not part of the estimate.**
   Nobody can tune this prompt against imagined registers. Phase 5 has the
   precedent on record: `report-card-subject-comment` needed a v2 the same
   day a real API key was first configured, because two defects appeared
   immediately that 154 structural eval checks could not see. Handwriting
   extraction will need at least one prompt revision cycle against real
   Nigerian school registers, and that cycle cannot start until someone
   photographs some. **Getting ~10 real registers from a pilot school is the
   critical path item.**

2. **Structural evals are close to worthless here.** `phase-5.md` §9 already
   flags that all 42 existing checks are structural — PII safety and prompt
   quality inspect *inputs*, registry and schema integrity inspect
   *definitions*. Whether the model read "Adaeze" correctly is a content
   question no existing check can answer. This feature needs a genuinely new
   kind of eval asset: photographed pages with hand-verified ground truth and
   a per-field exact-match accuracy metric. Building it is part of the work
   and there is no shortcut.

**Surface note:** the admin-facing app is `apps/web` (Next.js). On a phone
browser, `<input type="file" accept="image/*" capture="environment">` opens
the camera directly — no native app needed. `apps/mobile` is parent/student
facing per Phase 6 and is the wrong surface for an admin task. **Web-first,
and probably web-only.**

---

## 6. Open questions for Arinzechukwu — RESOLVED 2026-08-20 except one

1. **D3 — image retention.** ANSWERED: Option A, never persisted. See D3.
2. **D1 — the PII hard-rule amendment.** ANSWERED: approved as drafted, with
   the added requirement that it be a named per-prompt allowlist rather than
   a category. See D1 and §7.
3. **Model choice.** ANSWERED: Sonnet 5.
4. **Flag scan-created students as AI-extracted?** ANSWERED: yes, add now —
   same "cheap now, impossible later" reasoning as every other provenance
   field in this project. Shipped as `students.ai_extracted`.
5. **Pilot school for handwriting samples.** STILL OPEN — Arinzechukwu is
   confirming separately. **This is the one remaining item and it is the true
   critical path**: the prompt is at v1 and has never seen a real Nigerian
   register. See §8.

---

## 7. Implementation log (2026-08-20)

What shipped, and the decisions that only became visible while building.

**The AI seam.** `AiCallRequest` gained `images?: AiImageInput[]`, with
`widthPx`/`heightPx` REQUIRED rather than optional — the budget reservation
has no other way to price an image, and an optional dimension would let a
caller silently reserve nothing for a 4,784-token photo. `buildUserContent`
returns a bare string when there are no images, so all five shipped text
prompts produce byte-identical requests to before and no cached prefix is
invalidated.

**The reservation fix.** `estimateInputTokens` is now image-aware and takes
the model id, because visual-token caps are per-model. The tier table
(`MODEL_MAX_VISUAL_TOKENS`) lives in `models.ts` beside the price table,
since it is the same kind of thing: per-model arithmetic turning a request
into a token count. Twelve tests pin it, including a realistic full-page
scan landing at ~5,600 input tokens — which is what §4's cost table is built
on, so a drift there fails loudly rather than quietly invalidating the
published figures.

**Image dimensions without a dependency.** `image-dimensions.ts` parses
PNG/JPEG/WebP headers directly. `sharp` would have added a native binary to a
Fly container whose Dockerfile is already a known sore point, to read four
integers. The JPEG path is a real marker walk — a phone photo carries EXIF
and a thumbnail before the SOF — and it excludes 0xC4/0xC8/0xCC from the
SOF range, which is pinned by a test because mistaking a Huffman table for a
frame header yields a plausible wrong number rather than an error. Undecodable
headers return null and the caller charges the FULL tier cap: over-reserving
is the safe direction.

**Content-type sniffing, added during implementation and not in the plan.**
The multipart `Content-Type` is client-supplied and this payload goes to a
third party, so the bytes are sniffed instead. It also closes the
declared-JPEG/actual-PNG case, where the right `media_type` would otherwise
be wrong for perfectly valid bytes.

**A hole the plan did not anticipate.** A `STUDENTS_SCAN` job sits in `READY`
exactly like a validated CSV job, so `POST /imports/:jobId/commit` would have
accepted it — and that path takes its rows from the STORED SOURCE FILE, which
for a scan means committing the MODEL's extraction rather than the admin's
reviewed corrections. That is a direct bypass of D4's human gate. Both
directions are now closed explicitly (`WRONG_JOB_TYPE` in each service) and
both are tested. This is the sharpest thing found while building.

**The allowlist is mechanical, per D1's condition.**
`PII_BEARING_PROMPT_ALLOWLIST` in the PII eval suite pins the list at exactly
one entry; a second fails CI, so joining it is a visible deliberate edit. The
suite also asserts something worth stating plainly: **even the allowlisted
prompt's rendered TEXT carries no PII.** `renderStudentListExtractionPrompt`
receives only class arm names — school structure. The carve-out covers the
IMAGE channel alone, and a future edit threading a student's name into that
template fails the eval.

**sessionStorage was rejected for the web flow.** The CSV wizard parks its
upload response there so the next route can render without a refetch. Doing
the same here would write forty children's names, DOBs and guardian phone
numbers into browser storage, outliving the task. D3 keeps the image out of
server storage; parking its transcribed contents in the browser would hand
the same PII to a different store. So the flow is ONE page with three
in-memory phases, and navigating away loses the draft — the correct trade.

**Verified against a live database** after applying the migration:
`ai_extracted` is `boolean NOT NULL DEFAULT false`, `ImportJobType` carries
`STUDENTS_SCAN`, the global `admin` role holds `student.scan`, and
`SELECT count(*) FROM pg_proc WHERE prosecdef` returns **20** — unchanged,
as the migration's header states. Next SD cadence review still due at 23.

**Permissions.** `SMART_IMPORT_PERMISSIONS = ["student.scan"]`, its own
constant per CLAUDE.md's convention for non-Phase work. The commit reuses
`student.import` rather than minting a second permission, because committing
a scan IS a student import. The admin grant is an idempotent APPEND in the
migration, not the full-literal UPDATE the teacher/bursar grants use —
`ADMIN_PERMISSIONS` is computed from six constants with three filters, so a
literal would be a hand-transcribed snapshot of a derived list that silently
revokes anything added later.

**Tests.** 50 API tests across the new and touched AI paths (13 header
decoding, 12 reservation arithmetic, 11 scan service integration, plus the
pre-existing AI suites still green). Eval suite 154 → 176 checks. One E2E
covering reachability and safe degradation — deliberately NOT a real
extraction; see its header for why.

---

## 8. The one thing still blocking real use

**The prompt is at v1 and has never seen a real Nigerian register.**

Everything above is infrastructure, and infrastructure is the part this
project is reliably good at. The part that decides whether the feature is
usable — whether the model actually reads a handwritten Yoruba surname off a
photocopied page under a ceiling fan — is untested, and cannot be tested with
anything in this repo today.

The precedent is on record and it is recent: `report-card-subject-comment`
needed a v2 the same day a real API key was first configured, because two
defects appeared immediately that 154 structural eval checks could not see.
There is no reason to expect this prompt to be different, and several reasons
to expect it to be worse — handwriting varies more than score tables do.

So: **~10 photographed pages from a real school, with hand-verified ground
truth, then a per-field accuracy pass and almost certainly a v2.** Until that
happens this feature should not be switched on for a school, on exactly the
rule phase-5.md §9 already sets for slice 5: do not enable until someone has
read real output.

---
