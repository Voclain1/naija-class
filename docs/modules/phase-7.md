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

### D2 — Voyage model: `voyage-4` at 1024 dimensions

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

**RESOLVED 2026-09-02 — `vector(1024)`.** Confirmed from Voyage's model
documentation (MongoDB Docs → Voyage AI → Models) and corroborated by their
"Flexible Dimensions and Quantization" page, not inferred from `voyage-3.5`:

| Property | `voyage-4` |
|---|---|
| Output dimensions | **1024 default**; 256, 512, 2048 also supported |
| Context length | 32,000 tokens |

Use the **1024 default**. It is the balanced point of their range and needs no
`output_dimension` parameter, so the ingestion and query paths cannot drift
apart by one of them omitting it.

**A correction to what this section previously said.** The earlier draft warned
that a later dimension change means re-embedding the whole corpus. That is only
half true, and the research changed the answer. The voyage-4 family is trained
with **Matryoshka representation learning**, so a 1024-dim embedding can be
*truncated* to 512 or 256 and renormalised to obtain (approximately) the
model's native embedding at that size.

Practically:

- **Reducing** dimensions later (1024 → 512, e.g. to shrink the index) is a
  transformation of vectors we already hold. **No re-embedding, no Voyage
  spend, no re-upload.**
- **Increasing** (1024 → 2048) *does* require re-embedding, because the extra
  dimensions were never computed.

Choosing 1024 therefore keeps the cheap direction open and only forecloses the
expensive one, which is the right way round. It still requires a migration —
`vector(N)` is fixed at DDL time — but not a round-trip to the vendor.

**Also surfaced by this research, and deliberately left open:**
`voyage-context-4` exists specifically to produce *contextualised chunk
embeddings* — chunks embedded with awareness of the surrounding document
rather than in isolation — and supports auto-chunking up to 120K tokens.
That is aimed squarely at the problem D7 solves by hand. It costs $0.12/M
against `voyage-4`'s $0.06/M and carries the same 200M free allowance, so cost
is not the deciding factor at this scale.

It is **not** chosen here, because D7's structural chunking has a property this
slice specifically needs: a chunk keeps its heading path, and the heading is
what makes a retrieved chunk citable to a teacher (D10). Handing chunking to
the vendor risks losing that. But it should be **measured against D7's chunking
at CP4**, using the retrieval-precision fixture — that harness is exactly the
tool for deciding this, and guessing now would waste it.

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

### D4a — Voyage rate limits are the real ingestion constraint, not cost

**Observed live 2026-09-02**, not read from a docs page: an account with **no
payment method attached** is limited to **3 requests/minute and 10,000 tokens
/minute**. The fourth call in `packages/ai/evals/live-embedding.ts` returned
`429` with exactly that explanation.

This inverts the assumption in D2. Cost was never going to be the binding
constraint — 200M free tokens is far more than v1 will use — but **throughput
is**, and it bites precisely where the volume is: ingestion.

Concretely, a scheme of work chunked into ~60 chunks is one or two batched
requests by token count, but a corpus of several subjects across several class
levels is not. At 3 RPM, a naive per-chunk loop would take twenty minutes for a
single document.

Three consequences for CP2, none of which are optional:

1. **Batch aggressively.** Voyage accepts up to 1,000 inputs per request, so
   the unit of work is a batch of chunks bounded by the 10K TPM budget, never
   one chunk per call.
2. **Rate-limit and retry with backoff inside the ingestion worker.** A `429`
   must be a retry, not a `FAILED` document. This is a BullMQ job precisely so
   it can afford to wait.
3. **Adding a payment method lifts the limit**, and is worth doing before the
   first real ingestion regardless of the free allowance — the free tokens and
   the reduced rate limit are independent, and it is the rate limit that hurts.

Recorded here rather than left in a commit message because it changes what CP2
has to build, and it is exactly the kind of vendor detail that is expensive to
rediscover halfway through an ingestion pipeline.

**UPDATE 2026-09-02 (same day) — payment method added, limit confirmed
lifted.** Re-measured rather than assumed, because the whole of CP2 was sized
against the old number:

| Probe | Result |
|---|---|
| 12 sequential requests | all accepted, 5.2s total |
| 30 concurrent | all accepted, 0.98s |
| 200 concurrent | all accepted, 1.9s |
| 500 concurrent, sustained | all accepted, 11.6s — **~2,577 req/min** |

Zero `429`s across ~900 requests. Under the old tier, request #4 of the first
probe would have been refused.

**The ceiling could not be reached from this machine.** A second sustained
round of 500 produced 208 failures — but every one was a bare `fetch failed`,
i.e. LOCAL socket exhaustion, not a vendor refusal. That is a more useful
finding than a rate-limit number would have been, and it changed the design:
`retry.ts` classifies transient NETWORK faults as retryable alongside `429`,
because in a long ingestion run that class of error is the more likely of the
two. Treating only `429` as retryable would have left the more probable
failure mode unhandled.

**What this does NOT change.** All three consequences above stand. Batching is
still right (25 chunks in 1 request instead of 25 — measured live), the retry
is still required (transient faults, and a new account meets the 3 RPM tier
again), and the caps are still the spend control. The limit being lifted makes
ingestion fast; it does not make it safe.

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

**CP2 implementation note (2026-09-02) — `pdf-parse` is DISQUALIFIED.** The
obvious library for this was tried first and must not be reintroduced:
`pdf-parse@1.1.1` returns the **first document's text for every subsequent call
in the same process** (measured by parsing three different PDFs in sequence and
getting the first one's text back all three times, in both orders; the cause is
its pinned pdf.js v1.10.100 build on the fake-worker path). In a long-lived
ingestion worker that is a **cross-tenant content leak** with no visible
symptom — one school's scheme of work chunked, embedded and stored under
another school's document id, with every layer downstream reporting success.
The implementation uses `pdfjs-dist` (Mozilla's maintained build, per-call
document, explicitly destroyed), and `document-parser.spec.ts` carries a
regression test that parses two different PDFs in one process and asserts their
text differs.

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

### D13 — Heading extraction is fixed in CP3, not deferred (the real-document finding)

**The first real document broke the citation story while passing every check.**
Virgo Fidelis's JSS2 ENGLISH scheme of work ingested cleanly on 2026-09-02 and
reported 17 sections with **16 non-null headings**. The headings were
nonetheless useless: `ENGLISH` eight times, `COMPREHENSION` twice,
`TABLE OF CONTENT` twice, and **not one week among them**.

Two independent causes, diagnosed by reproducing the signature synthetically
(chunker output matched: `8x ENGLISH`, `1x TABLE OF CONTENT`,
`1x "1 COMPREHENSION 2"`, zero week-bearing):

1. **A running page header.** `ENGLISH` is printed at the top of every page.
   Text extraction concatenates pages, and the generic ALL-CAPS rule — the
   loosest in the chunker — promoted each occurrence to a level-1 heading,
   making it the root of every page's section.
2. **The weeks are inside a flattened table.** A tabular scheme extracts as one
   line per row (`3 Grammar: Nouns... By the end of...`), so `WEEK n` never
   appears alone and the WEEK rule never fired.

**Neither is the term-precedence bug flagged earlier** — that one is real but
separate, and is also fixed here (see below).

**Stripping the furniture alone does not work**, which is the finding that
decided the shape of the fix. Measured: removing repeated lines drops the
chunk count and merely swaps one class of noise (`8x ENGLISH`) for another
(contents-page fragments), still with **zero** week-bearing headings. Both
halves are required.

**The fix, and why it is contained rather than structural.** Recovering table
structure sounds like it needs x/y layout analysis over pdf.js text items —
genuinely larger work. It does not, because two things survive flattening: the
row begins with its **week number**, and the table **announces its own columns**
in a header line (`Week Topic Objectives ...`). That header is the guard that
makes rewriting safe; without it the rule would be "any line starting with a
digit is a week", which would mangle numbered lists in any other document.

Four parts, all in `packages/ai/src/chunking.ts`:

| Part | What it does |
|---|---|
| Repeated-line demotion | A short line occurring 3+ times is never a heading. It **stays as body text** — demoting furniture must not delete content, since a scheme repeating per-week boilerplate would otherwise lose it. |
| Tabular row recovery | Guarded by the column header; rewrites a row into `WEEK n` / `TOPIC: ...` / body, so recovered weeks nest and path exactly like natively-formatted ones. |
| Contents-entry rejection | `1 COMPREHENSION 2` is a contents row, not a heading. |
| Term precedence | `TERM` now outranks an unclassified capitalised line, so a cover block's `SUBJECT:` / `CLASS:` no longer pops `FIRST TERM`. |

Plus: in a document where row recovery fired, the generic ALL-CAPS rule is
suppressed entirely — otherwise recovered weeks nested under
`TABLE OF CONTENT`, a path that cites the wrong page.

Measured on the reproduction, before → after:

| | before | after |
|---|---|---|
| week-bearing headings | 0 | **8 of 8** |
| distinct headings | 3 | **9** |
| max repeat of one heading | 8 | **1** |

Conventional (non-tabular) schemes are unaffected and now carry the term:
`FIRST TERM SCHEME OF WORK > CLASS: JSS 2 > WEEK 3 > TOPIC: ...`.

**The lesson is about the test, not only the code.** CP2's suite asserted that
headings were NON-NULL — and this document would have passed. That is the wrong
property: a heading repeated eight times is non-null and worthless, while null
would at least have been an honest signal. The regression suite now asserts
**distinctness and informativeness**, and carries a fixture reproducing both
causes.

### D14 — Re-ingest the existing document rather than fixing only prospectively

Chunks are derived data, so the fix does not reach documents already ingested.
The document is re-ingested (delete + re-upload) rather than left as-is.
(Reported throughout as "JSS2 English"; the file is in fact the JSS3 English
scheme — noted so the two names are known to refer to one document.)

Worth doing because it is the **only piece of real-world evidence** that the
pipeline works end to end, and verifying the fix against the same content that
exposed the bug is the standard this project applies to every other fix. It is
also nearly free: re-embedding one document is a handful of Voyage requests
against a 200M-token free allowance. The checksum duplicate guard does not
obstruct this — it only refuses documents that are still live, so a delete
followed by a re-upload is permitted by design.

### D13/D14 — VERIFIED CLOSED, 2026-09-03

Re-ingestion ran against the fixed chunker and the output meets every condition
stated **in advance**. Recorded here rather than left in a conversation,
because this phase opened by discovering that a previous plan-first existed
only in chat history — and a verification whose result lives nowhere is the
same failure in a smaller box.

**The result was confirmed FRESH before it was assessed.** `createdAt`
`2026-09-03T10:53:21.723Z`, after both deploys (`a450dba` 09:12, `ace7fb1`
09:36). That check exists because the previous round's "unchanged" result
turned out to be a document that had never been re-ingested at all — the delete
had failed on a permission error, so the snippet re-read the original chunks.
**Always check `createdAt` before concluding anything about a re-ingestion.**

| Condition (stated before the run) | Result |
|---|---|
| No heading repeated **due to page furniture** | **PASS** — no `ENGLISH`, `COMPREHENSION` or `ABULARY` anywhere |
| A real `WEEK n` in most paths | **PASS** — 21 of 26 chunks (81%) |
| No path rooted at `TABLE OF CONTENT` | **PASS** — absent entirely |

Measured before → after on the real document:

| | before | after |
|---|---|---|
| week-bearing headings | 0 | **21 of 26** |
| repeated `ENGLISH` headings | 8 | **0** |
| term attribution | wrong by one term | **correct** |

`First Term WEEK 1-9`, `Second Term WEEK 1-9`, `Third Term WEEK 2-4` — 21
distinct week paths, no collisions. The distinctness is what specifically
confirms the term-label fix rather than merely being consistent with it:
without detecting the table-row term label, second- and third-term weeks
collide with first-term ones.

**The confirmed root causes** — both differed from the first two diagnoses,
which is why the source document was ultimately required:

1. `ENGLISH` ×8 was **not a running page header**. It is the second line of the
   wrapped cell `LITERATURE IN` / `ENGLISH`, recurring in every week of every
   term. Same mechanism for `COMPREHENSION` and, with a mid-word column break,
   `COMPREHENSION/VOC` / `ABULARY`.
2. Weeks were missing because row recovery required 120+ characters after the
   week number. Real rows are short (`1 REVISION OF LAST`, `10 REVISION`), so
   it never fired.

**Third Term Week 1 is absent, by design.** Its section is a single short line
that falls under the minimum chunk size and merges into the preceding chunk —
content preserved, heading lost. Predicted before the run, for that reason.

**Term-label repeats are benign.** The only repeated headings are bare term
labels. Two explanations exist and are distinguishable by ordinal: consecutive
repeats mean one long section was windowed; scattered repeats mean several
blocks sit under a term but outside any week row. Both make `First Term` a true
citation, and neither is the furniture bug.

#### What this does NOT establish

Stated explicitly, because over-claiming from thin evidence is the exact
failure this episode kept repeating:

- **One document, of one kind.** A syllabus.ng commercial ebook — a templated
  PDF, not a school-authored scheme. A hand-made Word export may extract
  differently. What is proven is that this document CLASS works, and that the
  fixture is now real, so the next surprise costs minutes rather than deploy
  cycles.
- **Good headings are not good retrieval.** Nothing here measures whether the
  right chunk comes back for a teacher's topic. That is CP3, and CP4's eval
  suite is what would measure it.
- **The heading is still not embedded.** `ingest.handler.ts` embeds `content`
  only. Now that headings are meaningful, prepending them is likely a real
  retrieval win — carried into CP3 as a design decision, not an afterthought.

#### The process lesson

Three diagnoses were made about this document. The first two were
reconstructions, both wrong, in different ways, and each cost a deploy cycle
before the error surfaced. The third was made against the source document and
was right first time.

The tests were wrong in the same way the diagnoses were: CP2's suite asserted
headings were NON-NULL, and this document would have passed. A heading repeated
eight times is non-null and worthless; null would at least have been honest.
The suite now asserts **distinctness and informativeness** against the
document's real extracted text.

**Get the real artefact before the second attempt at a fix, not the fourth.**

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

  // Prisma cannot express pgvector types. 1024 is voyage-4's default output
  // dimension, confirmed 2026-09-02 (D2). Record it in the migration header.
  // Reducing this later is a truncation of vectors already held, not a
  // re-embed — increasing it is not. See D2.
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

1. ~~**`voyage-4`'s output dimensionality**~~ — **RESOLVED 2026-09-02: 1024
   default** (256/512/2048 also available), 32K context. See D2, which also
   records the Matryoshka finding: reducing dimensions later is truncation, not
   re-embedding. No longer blocks the migration.
2. **NDPR**, per §7 and `docs/deferred.md`. Implementation stays blocked on
   this; planning does not.
3. **Voyage data-retention terms.** Does Voyage retain submitted text, and for
   how long? Feeds directly into (2), and is the sort of thing that must be
   read from their DPA rather than inferred from a marketing page.
4. **Chunk size, top-K, and hand-rolled vs `voyage-context-4`.** Deliberately
   not fixed here — all three should be measured against the CP4
   retrieval-precision fixture rather than guessed in a plan document.
   Sensible starting point: ~500-token chunks with ~50-token overlap, K=4,
   using D7's structural chunking. See D2 for why `voyage-context-4` is a
   real alternative worth measuring rather than dismissing.
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
3. ~~`voyage-4`'s dimension is confirmed~~ — **done 2026-09-02: 1024** (D2).
4. `VOYAGE_API_KEY` is provisioned, with the fail-soft path (D12) verified in
   the running app rather than assumed.
