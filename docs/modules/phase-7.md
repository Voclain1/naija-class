# Phase 7 — Curriculum RAG + Student Tutor

**Status:** plan-first, not approved, nothing built. Written 2026-09-02.

**Vendor decision:** Voyage AI for embeddings, already made. Anthropic ships
no embeddings API, so this phase needs a second AI vendor and that is the
chosen one. This document does not re-litigate it; it does record what
depends on it (§5, §7).

---

## 0. Why this document exists in this form

A previous Phase 7 plan-first and Voyage vendor comparison were believed to
exist. They did not — confirmed 2026-09-02: no `docs/modules/phase-7.md`, zero
occurrences of "Voyage" anywhere under `docs/`, nothing in any of six local
worktrees. The analysis existed only in conversation history, which is not a
place work is allowed to live.

So this is a fresh start, not a recovery, and it is committed before
implementation rather than after. Anything below that reads like a conclusion
from that lost work has been re-derived here against the actual codebase, not
remembered.

---

## 1. What is already true (verified, not assumed)

Everything in this section was checked against the repo on 2026-09-02. It
matters because Phase 7 is unusually well-supported by work already shipped.

| Thing | State | Where |
|---|---|---|
| `pgvector` extension | **Already enabled** | `20260514120000_init/migration.sql`, `infra/postgres/init/01-extensions.sql` |
| Budget-enforced AI call path | **Shipped** — reserve → call → settle | `apps/api/src/common/ai/ai-generation.service.ts` |
| Per-call cost ledger | **Shipped** — `ai_generations` | `schema.prisma` `model AIGeneration` |
| Per-school monthly budget counter | **Shipped** — `ai_budget_periods` | `model AIBudgetPeriod` |
| Typed prompt registry | **Shipped** | `packages/ai/src/prompts/registry.ts` |
| Eval harness | **Shipped** — `pnpm ai:eval` | `packages/ai/evals/` |
| Lesson plan generator | **Shipped**, prompt at v2 | `packages/ai/src/prompts/lesson-plan.ts` |
| Storage layer with typed keys | **Shipped** | `apps/api/src/common/storage/storage.types.ts` |
| AI live in production | **Yes** — confirmed 2026-09-02 | `docs/deferred.md` NDPR entry |

Two consequences worth stating plainly:

- **No new infrastructure is needed to make a Claude call safely.** Phase 7
  inherits budget enforcement, the cost ledger, the PII rules and the ESLint
  ban on bypassing `AiGenerationService`. What it adds is a *second vendor*
  and a *retrieval step*, and those are where the new design work is.
- **`pgvector` being pre-enabled removes the single most likely infrastructure
  blocker.** It was enabled in the very first migration, in anticipation of
  exactly this phase.

### 1.1 The eval gap, measured

`pnpm ai:eval` currently reports **176 passed, 1 skipped**. The skipped one is
the only case that spends real tokens (`live-generation.ts`, skipped without
`ANTHROPIC_API_KEY`).

All 176 are **structural**: registry integrity, JSON-schema validity, prompt
strings containing committed decisions, and PII-safety assertions. Not one
of them looks at whether generated content is *correct*. That gap is
long-standing and known; §8 is about closing it, and Phase 7 is the first
time closing it is genuinely tractable rather than merely desirable.

---

## 2. v1 scope — the smallest genuinely real thing

**v1 is: ground the existing lesson-plan generator in a school's own scheme of
work.** Nothing else.

Concretely, a teacher uploads their real scheme of work for a subject and
class level; it is chunked and embedded via Voyage; and when that teacher
generates a lesson plan for a topic, the relevant chunks are retrieved and
passed to Claude as grounding context.

### Why this slice, and not the tutor

This follows the pattern the project has used twice and both times correctly:

- **Phase 5** shipped the lesson plan generator before report-card comments —
  the lower-stakes, teacher-facing, human-reviewed surface first.
- **Phase 6** shipped guardian mobile before student mobile — the adult
  principal before the child one.

Curriculum grounding of lesson plans is the same shape a third time. It is
teacher-facing, already behind a human approval gate, carries no student PII,
and — crucially — **it is the one AI feature with a confirmed, reported
content-accuracy problem**. The lesson-plan prompt's own header claims
"curriculum-grounded … no generic ChatGPT answers" and cites that as the
product's moat, but today it is grounded only in a *description* of Nigerian
classroom reality inside the system prompt. The v2 output includes a
**Reference Materials** section that the model currently invents from its own
training data. Making that section cite the school's actual scheme of work is
a small, real, checkable win.

### What v1 is NOT

- **Not the student tutor.** See §9.
- **Not a shared national curriculum corpus.** Each school embeds its own
  documents, in its own tenant. A shared WAEC/NECO corpus is a real future
  idea with its own licensing questions (`docs/deferred.md` already flags
  curriculum content licensing as unresolved) and it is not v1.
- **Not scanned-document OCR.** See D6.
- **Not grounding for report-card comments, parent summaries or insights.**
  Those have no curriculum dependency.
- **Not a retrieval UI.** No "search the curriculum" screen. Retrieval is
  invisible plumbing behind the existing generate button in v1.

---

## 3. Decisions

### D1 — v1 grounds lesson plans only

Stated above. The alternative considered was building retrieval as a generic
service first and grounding nothing, which would have produced infrastructure
with no user-visible result and no way to tell whether the retrieval was any
good. Grounding one real feature is what makes the retrieval *testable*.

### D2 — Voyage model: `voyage-4`, pending a dimension check

Voyage's current line-up and pricing (checked 2026-09-02 against
`docs.voyageai.com/docs/pricing`):

| Model | $/1M tokens | Free allowance |
|---|---|---|
| `voyage-4-large` | $0.12 | 200M |
| `voyage-4` | $0.06 | 200M |
| `voyage-4-lite` | $0.02 | 200M |
| `voyage-context-4` | $0.12 | 200M |
| `voyage-context-3` | $0.18 | none |

**Cost is not a factor at v1 scale.** 200M free tokens is far beyond what this
phase will consume — a full scheme of work is on the order of tens of
thousands of tokens, so a pilot school's entire corpus embeds inside a
rounding error of the free tier. Choose on quality, not price: `voyage-4` as
the default, `voyage-4-lite` only if a measured reason appears.

**OPEN — must be resolved before the migration is written:** the exact output
dimensionality of `voyage-4`. The pricing page does not state it, and a
`vector(N)` column requires N to be fixed at DDL time. Do not guess this from
`voyage-3.5`'s 1024. Confirm from Voyage's model documentation, record the
number in the migration header, and treat a later dimension change as a
re-embed of the whole corpus, not an `ALTER`.

### D3 — Embedding calls do NOT go through `AiGenerationService`

`AiGenerationService` is the only path to **Claude**, enforced by an ESLint
ban on importing `@anthropic-ai/sdk` outside `packages/ai/src/client.ts`. That
boundary should be preserved exactly as it is, and Voyage should get its own
parallel one: a `VoyageEmbeddingService` in `apps/api/src/common/embeddings/`,
with a matching ESLint rule banning the Voyage SDK anywhere else.

Reusing `AiGenerationService` was considered and rejected. Its `GenerateParams`
requires a `PromptDefinition` (name, version, model, maxTokens) and its ledger
row requires `promptName`, `promptVersion` and `outputTokens` — **none of
which exist for an embedding call.** Forcing them would mean writing fictional
values into the compliance ledger, which is the one table in this system that
must not contain fiction.

This is the same reasoning `CLAUDE.md` already applies to `AIInteractionLog`
vs `AIGeneration`: two records that look similar are kept separate because
their shapes and purposes genuinely differ.

### D4 — Embedding spend is ledgered separately, and budgeted by COST not TOKENS

New table `embedding_generations` (§4), one row per Voyage call: model, token
count, latency, cost in micro-USD, success/error, and what was embedded
(document id for ingestion, or a marker for a query).

For the budget, the two dimensions are deliberately split:

- **`ai_budget_periods.tokensReserved` / `tokensActual` stay Claude-only.**
  A school's monthly budget is denominated in Claude tokens. Voyage tokens are
  ~50-250× cheaper per token, so adding them into the same counter would
  silently dilute the cap — 1M embedding tokens would consume the same budget
  as 1M Sonnet tokens while costing about 1% as much. That makes the budget
  mean less, not more.
- **`ai_budget_periods.costMicroUsd` DOES include embedding spend.** Money is
  money, and the AI Usage page's cost figure should be the true platform cost,
  not the Claude-only subset.

### D5 — Retrieval is not reserved; ingestion is

The reserve → call → settle shape exists because a Claude call is slow
(3–15 s) and expensive, so the budget must be enforced *before* it and
reconciled *after*.

An embedding of a query is neither. It is one short string — a subject name, a
class level and a teacher-typed topic, on the order of 20–50 tokens — costing
about **$0.000003**. Wrapping that in a two-transaction reservation would add
more database round-trips than the call itself costs, on a database where ~2 s
authenticated latency is already normal.

So:

- **Retrieval (query embedding):** no reservation. Call, then write one
  `embedding_generations` row and add the cost to the period. Ledgered, not
  gated.
- **Ingestion (document embedding):** *is* gated, because a school could
  upload a 500-page PDF. It runs as a **BullMQ job**, not in the request, and
  checks a per-school ingestion cap before embedding. This is where a runaway
  bill would come from, so this is where the enforcement belongs.

A per-school **document count and total size cap** is the actual control, and
it should be enforced at upload time where the user can see the refusal —
not after they have waited for a job to fail.

### D6 — v1 accepts text-layer PDF and pasted text. Scans are deferred.

The realistic formats a Nigerian school holds a scheme of work in are: a Word
document, a PDF exported from one, a **photocopy or phone photo**, or a
printed booklet.

v1 handles the first two, plus a plain-text paste box. **Scanned/photographed
documents are explicitly deferred**, because OCR is a genuinely separate piece
of work and the single biggest schedule risk in this phase (§10).

Recorded for whoever picks that up: this codebase **already has a working
vision-extraction path** — `student-list-extraction`, the one prompt on
`CLAUDE.md`'s PII-bearing allowlist, which transcribes photographed registers
via Claude vision. The same technique applied to a scheme of work would be
strictly *easier* to justify, because a curriculum page contains no student
PII and so would need no allowlist entry at all. That is a strong candidate
for the scanned-document slice, not a reason to pull it into v1.

### D7 — Chunking: by document structure, with a token ceiling

A scheme of work has natural units — week, topic, sub-topic. Chunk on those
headings where they can be detected, falling back to a fixed token window with
overlap where they cannot.

Store the detected heading path on the chunk (`heading`) rather than only the
raw text, because it is what makes a retrieved chunk *citable* — "Week 5:
Photosynthesis" is a reference a teacher recognises; a naked paragraph is not.
This directly feeds the Reference Materials section that motivated the slice.

### D8 — Retrieval is tenant-scoped in SQL, not in the service

Similarity search must run inside `withTenant` with the `app.current_school_id`
GUC set, and the query itself must carry `school_id` in its `WHERE` clause —
belt and braces, exactly as every other raw-SQL read in this codebase does.

Prisma cannot express a `vector` column, so `CurriculumChunk.embedding` is
`Unsupported("vector(N)")` and the similarity query is `$queryRaw`. That makes
this one of the few raw-SQL read paths in the app, so `CLAUDE.md`'s raw-SQL
rule applies directly: `SET LOCAL app.current_school_id` first, always.

**A cross-tenant retrieval leak here would be a curriculum document from
another school appearing inside a teacher's lesson plan.** It is worth an
explicit RLS spec case of its own, in the style of the existing
`rls.spec.ts` — school A's query returning zero of school B's chunks, proven,
not assumed.

### D9 — Grounding is additive to the prompt, and the prompt version bumps

Lesson plan prompt goes **v2 → v3**. The registry pins prompt name + version
into every ledger row, so this is automatically visible in `ai_generations`
and an A/B against v2 is possible with the existing
`evals/ab-lesson-plan-format.ts` pattern.

v3 adds a grounding block containing the retrieved chunks and instructs the
model to prefer them over its own knowledge and to draw Reference Materials
from them. It must also handle the **empty-retrieval case explicitly**: a
school with no uploaded scheme of work, or a topic with no relevant chunk,
must still produce a usable lesson plan. Grounding is an enhancement, never a
precondition — a school that has not uploaded anything must not experience
Phase 7 as a regression.

### D10 — Retrieved content is shown to the teacher

The teacher sees which chunks grounded their plan. Not a debug view — a short
"Based on: Week 5 — Photosynthesis (Basic Science scheme of work)" line.

Two reasons, and the second is the important one. It makes the feature legible.
And it is the human check on retrieval quality: if the wrong week was
retrieved, the teacher is the only person who will ever notice, and they can
only notice if they are told.

### D11 — Ingestion requires explicit confirmation of what is being uploaded

See §7. The upload flow states plainly that the document's text will be sent
to a third-party service outside Nigeria for processing, and asks the uploader
to confirm the document is curriculum material and does not contain student
personal data.

This is not a legal fig leaf; it is the actual control against the one real
data-class risk in this feature — a school uploading a document with a class
list stapled to the back of it.

### D12 — Voyage API key is a new secret, gated like `ANTHROPIC_API_KEY`

`VOYAGE_API_KEY` in `.env.example`, set as a Fly secret (via the **web
dashboard** — `flyctl` is blocked on the maintainer's machine, see
`docs/CODEX_HANDOFF.md`). Absent key must **fail soft** exactly as
`AiGenerationService` does for a missing Anthropic key: the feature reports
itself unavailable, ingestion refuses cleanly, and lesson plans still generate
ungrounded. A missing env var must never crash-loop the API — that has already
taken production down once in this project.

---

## 4. Data model

Two new tables, both under RLS + FORCE.

```prisma
model CurriculumDocument {
  id           String   @id @default(uuid())
  schoolId     String   @map("school_id")
  subjectId    String   @map("subject_id")
  classLevelId String   @map("class_level_id")

  title        String
  // Storage key for the original upload — the source of truth a teacher can
  // re-download. New key kind: { kind: "curriculum-document"; documentId }.
  storageKey   String   @map("storage_key")
  // Guards against re-embedding an identical re-upload.
  checksum     String
  status       CurriculumDocumentStatus @default(PENDING)
  // Redacted failure reason when status = FAILED.
  errorMessage String?  @map("error_message")
  chunkCount   Int      @default(0) @map("chunk_count")
  uploadedBy   String   @map("uploaded_by")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  chunks CurriculumChunk[]

  @@index([schoolId, subjectId, classLevelId])
  @@map("curriculum_documents")
}

enum CurriculumDocumentStatus {
  PENDING     // uploaded, not yet processed
  PROCESSING  // chunking / embedding in flight
  READY       // embedded and retrievable
  FAILED      // see errorMessage
}

model CurriculumChunk {
  id         String @id @default(uuid())
  // Denormalised for direct RLS, same pattern as StudentPortalInvitation.
  schoolId   String @map("school_id")
  documentId String @map("document_id")

  // Position in the source document — stable ordering for display.
  ordinal    Int
  // Detected heading path, e.g. "Term 1 > Week 5 > Photosynthesis". This is
  // what makes a chunk citable to a teacher (D7).
  heading    String?
  content    String
  tokenCount Int    @map("token_count")

  // Prisma cannot express pgvector types. N is fixed by D2's open dimension
  // question and must be recorded in the migration header.
  embedding  Unsupported("vector(1024)")

  createdAt  DateTime @default(now()) @map("created_at")

  document CurriculumDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([schoolId])
  @@index([documentId, ordinal])
  @@map("curriculum_chunks")
}
```

Plus the embedding ledger from D4:

```prisma
model EmbeddingGeneration {
  id           String   @id @default(uuid())
  schoolId     String   @map("school_id")
  // Null for query embeddings; set for ingestion.
  documentId   String?  @map("document_id")
  model        String
  // "ingest" | "query" — what the call was for.
  purpose      String
  inputTokens  Int      @map("input_tokens")
  latencyMs    Int      @map("latency_ms")
  costMicroUsd Int      @map("cost_micro_usd")
  success      Boolean
  errorMessage String?  @map("error_message")
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([schoolId, createdAt])
  @@map("embedding_generations")
}
```

**Notes on the shape:**

- `onDelete: Cascade` from document to chunk is correct here and deliberately
  *unlike* `AIGeneration`'s `SetNull`. A chunk has no independent meaning once
  its document is gone; a cost record does, because it is evidence money was
  spent. `embedding_generations` therefore does **not** cascade.
- The HNSW index on `embedding` is created in raw SQL in the migration, not by
  Prisma. Cosine distance (`vector_cosine_ops`) — Voyage embeddings are
  normalised, so cosine and inner product rank identically; cosine is the
  conventional choice and the one their docs use.
- New RLS policies go in `packages/db/prisma/policies/phase-7.sql`, following
  the existing per-phase file convention, and are copied verbatim into the
  migration as `phase-0.sql` established.

---

## 5. Integration with `AiGenerationService`

The generation path becomes two steps where it was one:

```
teacher clicks Generate
  │
  ├─ 1. embed the query          VoyageEmbeddingService  (~30 tokens, ~$0.000003)
  │     └─ ledger: embedding_generations (purpose="query")
  │
  ├─ 2. similarity search        withTenant + $queryRaw, top-K chunks
  │     └─ no external call, no cost
  │
  └─ 3. generate                 AiGenerationService.generate()  ← unchanged
        └─ reserve → call → settle, exactly as today
```

**Step 3 is completely unchanged.** The retrieved chunks arrive as additional
`userContent`; `AiGenerationService` neither knows nor needs to know that they
came from a vector search. That is the point — the existing budget
enforcement, ledger write and PII rules keep working without modification.

The one real interaction with the budget: **grounding makes the Claude call
bigger.** Retrieved chunks are input tokens, so the reservation's input
estimate must include them or every grounded generation under-reserves. The
reservation is computed from `userContent`, so this works automatically as
long as the chunks are in `userContent` and not smuggled in some other way —
worth an explicit test, since silently under-reserving would erode the budget
guarantee the hard rule exists to provide.

**Does retrieval cost enough to track?** Per call, no — $0.000003 is
noise. Tracked anyway, for three reasons: the ingestion side of the same
ledger genuinely can be significant; a per-call row is the only way to notice
a retry loop burning embeddings; and a cost ledger with a deliberate hole in
it is not a cost ledger. The cost is one small insert on a path that already
performs several.

---

## 6. What this does NOT change about existing AI features

Report-card comments, parent summaries and admin insights are untouched. No
prompt other than `lesson-plan` changes version. No existing ledger column
changes meaning. The PII-bearing prompt allowlist gains **no new entry** —
see §7.

---

## 7. NDPR and the actual data flow

This section is deliberately precise, because `docs/deferred.md` already
carries an open, unreviewed NDPR item covering third-party AI vendors, and
that item is **live** — AI is confirmed active in production as of
2026-09-02.

### What actually leaves the platform

| Leaves → Voyage | Does NOT leave |
|---|---|
| Curriculum / scheme-of-work document text | Student names, admission numbers, DOB |
| Subject name, class level label | Grades, attendance, report cards |
| Teacher-typed topic string | Guardian details, contact information |
| | Finance, payroll, BVN |

The query embedding is derived from **exactly the same inputs the lesson-plan
prompt already sends to Anthropic today** — class level, subject, topic. Phase
7 adds no new *category* of data to the existing Anthropic flow.

### Is this higher or lower stakes than what we already do?

**Lower stakes as to data class, but it is a NEW PROCESSOR.** Those are two
different questions and both matter:

- **Data class: materially lower.** Curriculum material is institutional
  content, not personal data. A scheme of work is the sort of document a
  school would hand to an inspector. `CLAUDE.md`'s AI hard rule about student
  PII is not engaged by it, and this feature requires **no new entry on the
  PII-bearing prompt allowlist**.
- **Processor: genuinely new.** Voyage AI (now owned by MongoDB) becomes a
  second overseas processor receiving school data. Under NDPR the relevant
  questions — lawful basis, cross-border transfer, processor agreement,
  subprocessor chain, data residency — apply *per processor*, and they have
  not been answered for the first one yet.

**Verdict: this belongs inside the existing NDPR review rather than beside
it.** It does not raise the urgency — the Anthropic flow already carries the
higher-stakes data and is already live — but it widens the scope by one
vendor, and adding a processor while the first one's posture is unreviewed
would be the wrong order of operations. Concretely: **`docs/deferred.md`'s
NDPR item should be updated to name Voyage as a second in-scope processor when
this phase is approved**, and implementation stays blocked behind that item as
already agreed.

### The one real new risk, and its control

Nothing above stops a school uploading a document that *does* contain student
personal data — a scheme of work with a class list appended, a mark sheet
scanned into the same PDF. That is the genuine failure mode this feature
introduces, and it is a human one, not a technical one.

D11's explicit confirmation at upload is the primary control. Worth
considering as a second layer, and flagged rather than decided here: a
lightweight pre-embedding screen that refuses a document matching obvious PII
shapes (long runs of names against admission-number patterns). That is real
work and could reasonably be its own slice; it should not be hand-waved as
"we'll add a regex".

---

## 8. Closing the content-quality eval gap

This is the part of Phase 7 with value beyond Phase 7.

### The gap, precisely

176 offline checks, all structural. They verify that prompts *say* the right
things and that schemas are valid. Not one asks whether a generated lesson
plan is *correct*. The reason that gap has survived is not neglect — it is
that content quality had no ground truth to be measured against. "Is this a
good lesson plan on photosynthesis?" is a judgement call, and the project has
rightly refused to fake it with a brittle string assertion.

### Why RAG changes that

**Grounding creates the ground truth.** Once a lesson plan is supposed to be
based on specific retrieved chunks, correctness becomes partly *mechanical*:

1. **Retrieval precision** — for a fixture scheme of work and a known topic,
   does the correct chunk come back in the top K? This is a pure, offline,
   deterministic check once the corpus is fixed. It needs no Claude call at
   all, only Voyage — and with 200M free tokens, it is free to run.
2. **Citation fidelity** — do the Reference Materials in the generated plan
   actually correspond to retrieved chunks, or did the model invent a textbook
   again? Checkable by comparing generated references against the chunk
   headings that were supplied.
3. **Grounding sensitivity** — generate the same topic with and without
   grounding and assert the outputs *differ* in the expected direction. If
   grounded and ungrounded output are identical, the grounding is not working
   however green everything else is. This is the check most likely to catch a
   silently broken retrieval path.

Checks 1 and 3 are the valuable ones and neither requires a subjective
judgement.

### Scope for the eval work in v1

Add a `curriculum-grounding` eval case file alongside the existing four, with
a small committed fixture corpus (one real scheme of work, anonymised, checked
into the repo). Retrieval-precision cases run offline in CI. Citation-fidelity
and grounding-sensitivity cases join `live-generation.ts` — skipped without
keys, exactly as the existing live case is, so CI stays free and deterministic.

**What this deliberately does not attempt:** an LLM-as-judge scoring rubric
for lesson-plan quality. That is a real technique and probably the eventual
answer, but it introduces a second model whose own accuracy needs
establishing, and it should not be smuggled in as a side effect of a RAG
slice. Mechanical groundedness first; judged quality is its own decision.

---

## 9. Student Tutor — a LATER slice, explicitly

The curriculum-grounded student tutor stays in Phase 7 as its eventual second
half, and is **not** part of v1.

It is not blocked on retrieval — v1 builds that. It is blocked on things v1
does not touch:

- **A conversational student-facing UI.** Every AI surface shipped so far is
  request/response into a form. A tutor is a *conversation*, with history,
  streaming and interruption. `AIInteractionLog`'s `sessionRef` exists to
  group exactly this and has never been exercised for it.
- **Real-time expectations.** A teacher waits 10 s for a lesson plan. A child
  will not wait 10 s per turn. That implies streaming, which the current
  `AnthropicPort` and the reserve → call → settle shape do not do — settle
  happens after a complete response.
- **Child-safety handling.** A free-text box in front of a child is a
  categorically different risk surface from a teacher's topic field. It needs
  its own thinking about refusals, escalation, and what a guardian can see.
- **Per-student budgeting.** The current cap is per-school monthly tokens and a
  per-user daily call cap. One enthusiastic student could consume a school's
  month. That is a real design problem, not a tuning exercise.

Any one of these is comparable in size to v1 itself. Attempting them together
with retrieval is how a phase becomes a quarter. **Retrieval that demonstrably
works, in front of a real feature, is the honest prerequisite for the tutor**
— and if v1's grounding turns out not to retrieve well, that is much better
discovered against a teacher's lesson plan than against a child's homework.

---

## 10. Checkpoints and estimate

| CP | Content | Estimate |
|---|---|---|
| **CP1** | Voyage client + `VoyageEmbeddingService` + ESLint boundary; schema, migration, RLS policies, RLS spec; `embedding_generations` ledger | 5–7 days |
| **CP2** | Upload → parse → chunk → embed pipeline (BullMQ), document status lifecycle, caps, upload UI | 6–9 days |
| **CP3** | Retrieval + lesson-plan prompt v3 + grounding display (D10) | 4–6 days |
| **CP4** | Content-quality eval suite (§8) + fixture corpus | 3–5 days |
| **CP5** | One-school rollout, following the AI-enablement rail | 2–3 days |

**Total: 20–30 working days — call it 4–6 calendar weeks** at this project's
observed solo pace.

### Why this is wider than the phases before it

`ARCHITECTURE.md` nominally budgets phases at 3–4 weeks. This one is estimated
wider on purpose, and the honesty is the point:

- **A new vendor is a new failure surface.** Every previous AI slice built on
  an Anthropic client that already worked in production. This one starts with
  an unproven integration, an unconfirmed embedding dimension (D2), and a new
  secret to provision through a web dashboard because `flyctl` is blocked.
- **Document parsing is the biggest unknown in the phase.** CP2's range is the
  widest for that reason. "PDF with a text layer" covers a lot of ground, and
  real school documents are messier than test fixtures. If CP2 runs long, this
  is why — and the mitigation is already in the plan: the plain-text paste box
  is the escape hatch that keeps the slice shippable when a file will not parse.
- **CP4 has no precedent to copy.** Every other eval in this repo asserts
  structure. This is the first that measures behaviour, and first-of-a-kind
  work is where estimates are least reliable.

Prior art for the estimate being right to widen: Phase 6's mobile work and the
payment-links initiative both ran past their initial framing, and in both
cases the overrun came from an external dependency rather than the core logic.
This phase has two such dependencies (Voyage, document formats).

---

## 11. Open questions

1. **`voyage-4`'s output dimensionality** (D2). Blocks the migration. Confirm
   from Voyage's model docs before CP1 writes DDL.
2. **NDPR**, per §7 and `docs/deferred.md`. Implementation stays blocked on
   this; planning does not.
3. **Voyage data-retention terms.** Does Voyage retain submitted text, and for
   how long? Feeds directly into (2), and is the sort of thing that must be
   read from their DPA rather than inferred from a marketing page.
4. **Chunk size and top-K.** Deliberately not fixed here — these should be
   tuned against the CP4 retrieval-precision fixture rather than guessed in a
   plan document. Sensible starting point: ~500-token chunks with ~50-token
   overlap, K=4.
5. **Re-embedding on document update.** When a school uploads a corrected
   scheme of work, the old chunks must go. Cascade delete handles the
   mechanics; the product question of whether previously-generated lesson
   plans should be flagged as based on a superseded document is unanswered.
6. **A shared national curriculum corpus** — the obvious next idea after
   per-school documents, and the one with a real licensing question already
   flagged in `docs/deferred.md`. Out of scope here; recorded so it is not
   mistaken for an oversight.

---

## 12. What must be true before implementation starts

1. This plan-first is reviewed and approved.
2. The NDPR item has been addressed, **or** a deliberate, recorded decision
   has been made to proceed regardless (`docs/deferred.md` already states this
   condition and that option (b) must be written down, not arrived at).
3. `voyage-4`'s dimension is confirmed (Q1).
4. `VOYAGE_API_KEY` is provisioned, with the fail-soft path (D12) verified in
   the running app rather than assumed.
