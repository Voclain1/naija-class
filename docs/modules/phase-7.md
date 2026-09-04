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
7. **CP4's labelled query set — WHO WRITES IT.** Open, and it gates whether
   CP4's numbers mean anything (D22). The suite needs 5-10 topics a real Virgo
   Fidelis teacher would actually type, each labelled by them with the week it
   should land on, plus one or two they would expect to find nothing for.
   Author-generated queries measure internal consistency rather than quality:
   one of CP3's own five was `"consonants sheep chip fish pitch"`, which
   quotes the document almost verbatim and is therefore easy by construction,
   where a teacher's `"pronunciation practice"` is the honest test. Same
   lesson as D13/D14 — a reconstruction was wrong twice, the real artefact was
   right first time. Requested via Arinzechukwu 2026-09-03; if it does not
   arrive, CP4 ships with the gate at `warn` and labels its own evidence weak.
8. **Absolute distance floor vs relative best-vs-rest separation.** D17's 0.69
   is one tuned constant in a 0.107-wide measured gap. D23 makes this CP4's
   decision, from the measured distance distribution rather than from
   argument. Recorded here because it is genuinely unresolved, not merely
   deferred.

---

## 12. What must be true before implementation starts

1. This plan-first is reviewed and approved.
2. The NDPR item has been addressed, **or** a deliberate, recorded decision
   has been made to proceed regardless (`docs/deferred.md` already states this
   condition and that option (b) must be written down, not arrived at).
3. ~~`voyage-4`'s dimension is confirmed~~ — **done 2026-09-02: 1024** (D2).
4. `VOYAGE_API_KEY` is provisioned, with the fail-soft path (D12) verified in
   the running app rather than assumed.

---

## 13. CP3 plan-first — retrieval, prompt v3, grounding display

Written 2026-09-03, after D13/D14 closed. CP2 gave this checkpoint a corpus
whose citations are real; CP3 is what finally puts it in front of a teacher.

**Scope:** tenant-scoped similarity search, lesson-plan prompt v2 → v3, and the
grounding display. Nothing else. No retrieval UI, no tutor, no re-ranking.

### 13.1 What CP3 inherits, verified not assumed

Checked against the repo on 2026-09-03:

| Thing | State |
|---|---|
| `curriculum_chunks` with `vector(1024)` + HNSW | live in production |
| RLS + FORCE on all three curriculum tables | live, spec'd in `curriculum-rls.spec.ts` |
| `EmbeddingService.embed()` with `inputType: "query"` | shipped CP1, ledgered as `purpose: "query"` |
| Meaningful heading paths on real documents | verified 2026-09-03 (D13/D14) |
| `AiGenerationService.generate()` reserve → call → settle | shipped Phase 5 |
| `LESSON_PLAN_PROMPT` at v2, `renderLessonPlanPrompt()` pure | `packages/ai/src/prompts/lesson-plan.ts` |
| `LessonPlansService.create()` calls `ai.generate()` outside the transaction | `lesson-plans.service.ts:117` |

The call site matters: generation already happens **outside** the tenant
transaction, at the reserve/call/settle boundary. Retrieval slots in
immediately before it with no restructuring.

### 13.2 Decisions

#### D15 — The heading is embedded WITH the chunk, and the corpus is re-embedded once

Today `ingest.handler.ts:124` embeds `c.content` only; the heading is stored
but never seen by the model. That was defensible while headings were
meaningless. Now that they are real, it is a measurable loss: `WEEK 5` and
`First Term` are exactly the terms a teacher's query uses, and they appear
nowhere in the embedded text.

**Embed `"{heading}\n\n{content}"`.** Retrieval is over a single vector per
chunk, so the heading has to be *inside* it to influence similarity at all.

Two consequences stated plainly rather than discovered later:

1. **Existing chunks must be re-embedded.** A corpus embedded content-only and
   one embedded heading-plus-content are not comparable — mixing them makes
   similarity scores mean different things for different rows. This is a
   one-time backfill, not an ongoing cost: at 200M free tokens and a handful of
   requests per document, re-embedding every chunk a pilot school holds is
   free and takes seconds. The backfill re-uses the ingest handler's existing
   idempotent delete-then-insert path.
2. **`tokenCount` drifts.** It is computed on `content` and used for batch
   budgeting. Adding the heading adds real tokens the planner does not count.
   The budget is already deliberately conservative (8K against a much larger
   real ceiling), so this is headroom being spent rather than a bug — but the
   estimate must include the heading, or the two will diverge further as
   headings get richer.

**Not doing:** a separate heading vector, or a hybrid keyword+vector search.
Both are real techniques and both are premature before CP4 can measure whether
retrieval is actually failing.

#### D16 — Retrieval is scoped to (school, subject, class level), and that scoping is in SQL

A lesson plan is generated for one subject and one class level, and
`CurriculumDocument` carries both. Retrieval filters on them.

This is not only relevance — it is a **correctness** boundary. Without the
subject filter, a JSS3 English query can retrieve a Basic Science chunk that
happens to be lexically close, and the teacher gets a lesson plan grounded in
the wrong subject's scheme. That is worse than no grounding, on exactly the
reasoning D13 settled for citations.

Per D8, the query runs inside `withTenant` (GUC set) **and** carries
`school_id` in its `WHERE` clause. Belt and braces, as every other raw-SQL read
in this codebase does. `curriculum-rls.spec.ts` gains a retrieval case: school
A's query returns zero of school B's chunks, proven with both schools holding
an identical vector so only RLS can separate them.

#### D17 — Top-K is 5, with a distance floor of 0.69 (measured, not guessed)

`ORDER BY embedding <=> $query LIMIT 5`.

**5** because a lesson plan's grounding block competes for prompt space with
the existing system prompt, and five ~500-token chunks is ~2,500 tokens — real
context without crowding out the instructions that produce the Nigerian lesson
note format.

**The distance floor matters more than K.** Cosine distance always returns a
nearest neighbour, even when nothing is relevant: a school that uploaded only a
Mathematics scheme will still get five Mathematics chunks for an English topic,
ranked confidently. Grounding a lesson plan in those is worse than not
grounding it. So a chunk is only used below a maximum distance, and if nothing
qualifies the generation proceeds ungrounded (D18).

**The threshold was checked against the real corpus before shipping, and the
first guess was wrong.** 0.55 was the proposed starting value. Measured
2026-09-03 against the real JSS3 English scheme — chunks embedded
heading-plus-content per D15, five plausible English queries and five
Mathematics/Science ones, distances computed as `1 - cosine similarity` exactly
as pgvector's `<=>` returns:

| | nearest-chunk distance |
|---|---|
| genuine matches | 0.5524 – **0.6391** |
| false matches (other subjects) | **0.7456** – 0.8343 |

**0.55 would have rejected all five genuine matches.** Every real query scored
above it. Grounding would have silently never fired: retrieval would run, cost
a query embedding, find nothing "close enough", and every lesson plan would go
out ungrounded while the feature reported itself working. Exactly the class of
untested guess about real content this phase has already paid for twice.

**Threshold is therefore 0.69**, the midpoint of the measured gap
(0.6391 → 0.7456). Still provisional, still CP4's to tune, but now sitting
between two measured populations rather than picked from the air.

Two findings worth carrying forward:

- **Ranking is already good; only the threshold was wrong.** "adverbs of
  frequency" → `First Term > WEEK 3` (the document's week 3 grammar row is
  "Adverbs of Frequency"); "consonant contrast sheep and chip" →
  `First Term > WEEK 8` ("Consonants /ʃ/ and /tʃ/ — sheep/chip"). The right
  week comes back. That is the strongest signal yet that CP3's premise holds.
- **The gap is narrow — 0.107.** Ten queries against one document of one
  subject is thin evidence for a delicate number, and a second subject in the
  same corpus could move it. This is what makes D20's decision to LOG distances
  load-bearing rather than nice-to-have, and it is worth CP4 considering a
  RELATIVE criterion (best-vs-rest separation) instead of an absolute floor,
  which would not depend on a single tuned constant at all.

#### D18 — Grounding is additive; the ungrounded path stays first-class

Restating D9 because CP3 is where it becomes code. Every one of these must
produce a normal, usable lesson plan:

- a school with no uploaded documents at all;
- a school whose documents are still `PENDING`/`PROCESSING`;
- a topic with no chunk under the distance floor;
- `VOYAGE_API_KEY` absent, or the embedding call failing.

The last one deserves its own note: **a retrieval failure must never fail a
generation.** The query embedding is one network call to a second vendor, and a
teacher pressing "generate" should not lose their lesson plan because Voyage
had a bad minute. Retrieval is wrapped so any error degrades to ungrounded,
logged at warn, with the reason surfaced in the grounding display rather than
swallowed.

#### D19 — Prompt v2 → v3, and the empty case is part of the prompt, not around it

`renderLessonPlanPrompt` gains an optional `groundingChunks` argument and the
version bumps to `3`. The registry pins name + version into every
`ai_generations` row, so v2/v3 are separable in the ledger and A/B-able with
the existing `evals/ab-lesson-plan-format.ts` pattern.

v3 instructs the model to prefer the school's own scheme over its training
data, and to draw **Reference Materials** from it — the section that today is
invented, and the one §2 named as the concrete win.

The empty case is handled **inside** the render function, not by branching
between two prompts. One prompt with a conditional block keeps a single string
under eval, where two prompts would drift and only one would get tested.

`renderLessonPlanPrompt` stays a pure function of its inputs — no database, no
`new Date()` — so the eval harness can assert on the exact string.

#### D20 — The grounding display cites, and says when it did not ground

Per D10, a short line under the plan: *"Based on your Basic Science scheme of
work — First Term > WEEK 5."* The heading path is the citation, which is the
whole reason D13 mattered.

**And it says so when nothing was retrieved.** "No matching section found in
your uploaded schemes" is more useful than silence: it tells a teacher whether
to upload something, and it is the only way anyone will notice retrieval
quietly failing. Silence on the empty path would hide exactly the failure this
display exists to catch.

Storage: a nullable `groundedOn` JSON column on `LessonPlan`, holding chunk
ids, heading paths, document titles and distances. A column rather than a join
because a lesson plan is a **historical record** — it must keep showing what
grounded it even after the document is deleted and its chunks cascade away.
Same instinct that keeps `embedding_generations` from cascading.

Distances are stored, not only displayed. CP4 needs real retrieval scores from
real use to set D17's threshold, and the alternative is another guess.

### 13.3 Shape

```
packages/ai/src/prompts/lesson-plan.ts     v3 + grounding block
apps/api/src/modules/curriculum/
  curriculum-retrieval.service.ts          embed query -> $queryRaw -> filter
apps/api/src/modules/lesson-plans/
  lesson-plans.service.ts                  retrieve before ai.generate()
packages/db/prisma/schema.prisma           LessonPlan.groundedOn Json?
apps/web/.../lesson-plans/[id]/page.tsx    grounding line
```

One new service, one prompt version, one nullable column, one UI line. No new
queue, no new vendor, no new permission — retrieval is not a user action, it is
something `lesson-plan.create` already authorises (per D-note in
`PHASE_7_PERMISSIONS`).

### 13.4 Verification

Offline, in CI:

- retrieval scoping — school A gets zero of school B's chunks, with identical
  vectors so only RLS separates them;
- subject/class-level filtering excludes a lexically-close wrong-subject chunk;
- the distance floor rejects an unrelated corpus;
- all four ungrounded paths produce a complete lesson plan;
- an embedding failure degrades to ungrounded rather than throwing;
- v3 renders both the grounded and empty forms deterministically.

Live, by hand:

- a real query against the re-ingested JSS3 scheme returns the *right week* —
  the first end-to-end evidence that retrieval works on real content, and the
  direct successor to D14's verification.

**What CP3 does NOT verify:** whether retrieval is *good*. One hand-checked
query is an existence proof, not a measurement. That is CP4's entire job, and
D17's threshold stays explicitly provisional until then.

### 13.5 Estimate

**4–6 days**, unchanged from §10. The range is honest rather than padded: the
retrieval query itself is an afternoon, and the time is in the four ungrounded
paths, the re-embedding backfill, and the prompt A/B.

**The one thing that could make it longer** is discovering that retrieval
returns plausible-but-wrong chunks on the real corpus — a quality problem, not
a plumbing one, and the only mitigation is that D20 logs distances so CP4
inherits data instead of another reconstruction.

---

## 14. CP4 plan-first — the content-quality eval suite

Written 2026-09-03, after CP3 shipped. §8 sketched why RAG makes content
quality measurable; this is the design for actually measuring it.

**Scope:** a `curriculum-grounding` eval case measuring retrieval quality
against a labelled query set, plus grounding-sensitivity and citation-fidelity
checks. Six decisions, D21–D26.

### 14.1 What CP3 left unmeasured

CP3 proved retrieval *functions*: five queries returned the right week, and a
Mathematics query was rejected. That is an existence proof by five
hand-checks, and two things about it should worry anyone:

- **The margin is thin.** `WEEK 2` was accepted at 0.6461 against a 0.69 floor
  — 0.044 of headroom. The Mathematics rejection sat 0.145 outside. A
  differently-formatted document could invert that.
- **I wrote the queries, the chunker, the retrieval and the check.** One of my
  five was `"consonants sheep chip fish pitch"`, which quotes the document's
  own wording almost verbatim. That is an easy query BY CONSTRUCTION. A
  teacher typing `"pronunciation practice"` is the honest test, and I could
  not have found that gap from inside my own assumptions.

The second point is the real subject of this checkpoint. **A suite whose
queries, corpus and scorer all come from the same author measures internal
consistency, not quality.** It can score 100% and mean nothing. Every decision
below is shaped by that.

### 14.2 Decisions

#### D21 — hit@K is the pass/fail metric; hit@1 and precision are reported, not gated

All K retrieved chunks go into the prompt, so the operative question is
whether the right week is *anywhere* in the retrieved set — not whether it
ranked first. **hit@5 is the gate.**

`hit@1` and `precision@5` are reported at **warn** severity. They are real
quality signals — a plan grounded in one relevant chunk and four irrelevant
ones is diluted even when hit@5 passes — but gating on them would fail CI for
a ranking wobble that changes nothing a teacher sees. The harness already
distinguishes `check` (error) from `warn` (tripwire); this uses that
distinction as intended.

**Distances are reported alongside every result**, not just the verdict. The
scores tell us whether retrieval works; the distance *distribution* is what
D23 needs, and a suite that printed only pass/fail would answer the easy
question and discard the data for the hard one.

#### D22 — THE QUERY SET MUST NOT BE AUTHORED BY ME. Provenance is an open question.

**This is the one decision CP4 cannot make on its own, and it is recorded as
an open question rather than resolved.**

The requirement: 5–10 topics from a **real Virgo Fidelis teacher**, verbatim,
plus — critically — **which week of the scheme each should land on**. The
label has to come from them too; me deciding what the right answer is
reintroduces exactly the circularity this avoids.

Also wanted: **one or two queries they'd expect to find nothing for.** Negative
cases are what test the floor, and my Mathematics-against-English probe is an
artificially easy version — no lexical overlap at all. A near-miss inside the
same subject (a topic the school covers in a *different term*) is the case
that would actually find a bad threshold.

**Precedent for insisting on this.** Two reconstructions of the source
document were wrong in two different ways, each costing a deploy cycle; the
diagnosis made against the real document was right first time. A reconstructed
query set is the same mistake in a different place. `docs/modules/phase-7.md`
D13/D14 records that episode; this decision exists because of it.

**If real queries do not arrive**, CP4 still ships — but the suite is labelled
in its own output as **author-generated and therefore weak evidence**, and the
gate runs at `warn` rather than `error`. A suite that overstates its own
authority is worse than one that admits its limits, because the first one gets
trusted.

#### D23 — The absolute-vs-relative threshold decision is CP4's to make, from measured data

D17's 0.69 floor is a single tuned constant sitting in a 0.107-wide gap. The
alternative flagged at CP3 is a **relative** rule — accept a chunk only if it
is meaningfully closer than the rest of the corpus (e.g. best distance versus
the median, or a gap between the best and the K-th) — which would not depend
on a constant at all.

**CP4 decides this by measuring, not by argument.** With the query set in hand
the suite reports, for each query, the full distance profile of the corpus.
Two things then become visible that cannot be reasoned about:

- whether genuine and spurious matches separate more cleanly in absolute
  distance or in best-vs-rest margin;
- whether the separation holds across *subjects and document formats*, which
  is the axis a single constant is most likely to fail on.

**Honest limitation stated up front:** with 5–10 queries there is no
meaningful train/test split. If the floor is tuned on the same queries the
score is reported against, the score is optimistic and must say so. The
suite therefore prints the floor's provenance — "fitted on this set" versus
"held out" — beside the result. Whichever it is, it will not be silent.

**UPDATE 2026-09-04 — the first real evidence has arrived, and it narrows the
gap sharply.** A teacher-supplied within-subject negative cut the measured
separation from 0.1302 to 0.0415, leaving the 0.69 floor clearing a genuine
positive by 0.0106. The floor is not being changed on one data point, but this
is direct evidence for the relative rule. See §14.7.

#### D24 — Grounding sensitivity: the check most likely to catch silent breakage

Generate the same topic twice, with and without grounding, and assert the
outputs **differ in the expected direction** — specifically that the grounded
plan's Reference Materials cite the supplied chunk headings and the ungrounded
one does not.

This is the highest-value check in the suite and the reason is worth stating:
**every other signal can be green while grounding does nothing.** Retrieval
can return the right chunks, the prompt can contain them, the ledger can
record v3, the UI can display citations — and if the model ignored the
grounding block entirely, nothing above would notice. Identical grounded and
ungrounded output is the one observation that catches it.

Live (needs `ANTHROPIC_API_KEY`), so it skips loudly in CI exactly as
`live-generation.ts` does.

#### D25 — Citation fidelity is checked mechanically, against the supplied headings

Do the generated Reference Materials correspond to chunks that were actually
retrieved, or did the model invent a textbook again? Comparable mechanically:
the headings supplied to the prompt are known, so a generated reference either
matches one or does not.

Deliberately a **warn**, not a gate. A model legitimately citing the
recommended textbook the scheme itself names (the real document lists six)
would fail a strict "only cite supplied headings" rule while being entirely
correct. The signal worth having is the *rate* of unsupported citations, not a
binary.

#### D26 — NOT LLM-as-judge. Restated because CP4 is where the temptation peaks.

§8 already ruled this out; it is repeated here because a checkpoint titled
"measure quality" is precisely where a scoring rubric gets smuggled in.

An LLM judge introduces a second model whose own accuracy needs
establishing — and establishing it requires labelled data, which is the thing
D22 says we do not yet have. Adding a judge now would answer an unmeasured
question with an unvalidated instrument, and produce numbers that look far
more authoritative than they are.

Mechanical groundedness first. Judged quality is its own decision, with its
own plan-first, once there is a labelled set big enough to validate a judge
against.

### 14.3 Shape

```
packages/ai/evals/cases/curriculum-grounding.ts   offline: retrieval precision
packages/ai/evals/fixtures/query-set.ts           labelled queries + provenance
packages/ai/evals/live-grounding.ts               live: sensitivity + citations
packages/ai/evals/run.ts                          register the new case
```

The offline case needs **Voyage but not Anthropic** — query embeddings only,
free against the 200M allowance. That places it awkwardly relative to the
existing split, so: it runs when `VOYAGE_API_KEY` is present and **skips
loudly** otherwise, matching `live-generation.ts`'s contract rather than
inventing a third tier.

The corpus is the fixture CP3 already committed
(`__fixtures__/real-scheme-of-work.ts`) — real extracted text, not a
reconstruction. It currently lives under `apps/api`; CP4 moves it to
`packages/ai/evals/fixtures/` so the eval can import it without a
package-boundary violation, and the API spec imports it from there.

### 14.4 What CP4 does NOT establish

- **Whether lesson plans are GOOD.** Only whether they are grounded in the
  right source. A well-grounded plan can still be poorly written, and nothing
  here measures that (D26).
- **Generalisation beyond one document class.** The corpus is one syllabus.ng
  ebook. A hand-made Word export may chunk and retrieve differently, and one
  document cannot tell us.
- **That the threshold is right for other subjects.** English is the only
  subject in the corpus. D23's measurement is honest about the axis it cannot
  cover.

### 14.5 Dependencies and estimate

**Two real dependencies, both external:**

1. **The re-ingestion** (D15's heading-plus-content embedding). Any baseline
   measured before it is against a floor calibrated for a different embedding,
   and would have to be discarded. Blocks measurement, not design.
2. **The teacher query set** (D22). Blocks the suite being *trustworthy*, not
   its construction.

**Estimate: 3–5 days**, unchanged from §10, and this is the widest-risk
checkpoint in the phase for a reason §10 already names: it has no precedent in
this repo to copy. Every one of the existing 180 evals asserts structure; this
is the first that measures behaviour.

**The harness is the easy half.** The hard half is the query set, and its cost
is not engineering time — it is the wait for real input, and the discipline not
to fill the gap with my own reasoning while waiting.

### 14.6 First run — findings, 2026-09-04

The harness is built and running against the placeholder set. Recorded now
because these are measurements, and a measurement that lives only in a
terminal is the failure §0 opened this document with.

**Against the real JSS3 English corpus, 17 chunks, 6 positive and 2 negative
queries:**

| metric | result |
|---|---|
| hit@5 (the gate) | **5 / 6** |
| hit@1 | 3 / 6 |
| MRR | passes (≥ 0.5) |
| negatives rejected by the floor | **2 / 2** |
| distance separation | floor sits in the gap |

**All checks report at `warn`, and a permanently-failing line says CP4 IS NOT
CLOSED.** That is D22 working as designed, not a fault to be cleared.

**Three findings, two of them about my own work:**

1. **My metric was unsatisfiable.** The first version asserted
   `precision@5 >= 0.5`. With exactly one correct week per query and K=5,
   precision cannot exceed 0.2 — no correct system could ever have passed it.
   Replaced with mean reciprocal rank, which is the right metric for a single
   relevant item. Caught by running the suite, not by reading it.

2. **My label was wrong.** `"class debate on a social issue"` was labelled
   week 7; retrieval returned week 9. Both weeks run a debate, so week 9 was
   correct and the *label* was the error. `expectedWeeks` is now a list. This
   is precisely the mistake D22 predicts an author makes about their own
   corpus, and it appeared within minutes of the suite first running.

3. **A genuine retrieval miss, kept rather than tuned away.**
   `"introducing the parts of speech at the start of term"` does not retrieve
   week 1, whose grammar row is "Parts of speech – Revision". The week-1 chunk
   ranks below five less relevant weeks. The likely cause is chunk
   GRANULARITY: a whole week is one chunk, so a sub-topic query competes
   against four other sub-topics in the same chunk and the signal is diluted.

   **Deliberately not fixed here.** Splitting chunks at the sub-row level is a
   design change with real costs — more chunks, more embedding, weaker
   week-level citations — and it should be decided against a teacher's queries,
   not against mine. Recorded as the first substantive question CP4 hands to
   whoever tunes retrieval.

**Also fixed while building this: `pnpm ai:eval` was never run by CI.**
`CLAUDE.md` calls it "required before any prompt PR merges", but the workflow
ran only lint, typecheck and test — so the gate was manual, and the eval
sources were neither linted nor typechecked (packages/ai's tsconfig covers
`src/**` only). CI now runs it. The suite was designed from the start to gate
without an API key, so this costs nothing and the two key-dependent cases skip
loudly.


### 14.7 The teacher's negative collapses D23's margin — 2026-09-04

**This is the observation D23 was deferred to wait for.** It arrived from one
query, and it is direct evidence for the relative-threshold alternative.

A real Virgo Fidelis English teacher was asked for the within-subject negative
D22 said the floor actually needs — a topic they would expect this scheme to
have nothing useful for. They gave:

> "Writing a university-level academic research paper with APA citations"

Verified against the real fixture before adding it: the scheme has no
research-paper, source, bibliography or citation-format content anywhere. But
unlike the author's cross-subject negatives, it collides lexically with three
real entries — First Term WEEK 3's *"Reading to cultivate the skill of
**referencing**"* (a comprehension skill, not academic citation), Third Term
WEEK 3's *"Review of Argumentative / Expository Essay"* (the nearest
legitimate writing neighbour), and First Term WEEK 1's *"my plan for the
**academic** session"*.

**Measured against real Voyage embeddings, all three negatives are correctly
rejected — but not by remotely comparable margins:**

| negative query | source | nearest distance | margin outside the 0.69 floor |
|---|---|---|---|
| simultaneous linear equations and factorisation | author | 0.8124 | 0.1224 |
| the causes of the Nigerian civil war | author | 0.8096 | 0.1196 |
| **university-level academic research paper with APA citations** | **teacher** | **0.7209** | **0.0309** |

The teacher's negative sits **four times closer to the floor** than either
author-written one. The separation gap that D23 must reason about therefore
collapses:

```
worst genuine match   0.6794   ("class debate on a social issue")
best false match      0.7209   (the teacher's negative)
gap                   0.0415   <- was 0.1302 before this query existed
floor 0.69 sits inside it, with 0.0106 of headroom above a REAL POSITIVE
```

**One teacher query cut the apparent safety margin by 68%.** The floor still
separates correctly, but it now clears a genuine positive by roughly one
hundredth of a distance unit — and that is measured on a corpus of ONE
document in ONE subject, which is the axis D23 already named as the one a
single constant is most likely to fail on.

**The floor is NOT being changed on this.** One data point does not justify
retuning a shipped constant, and moving it to widen the negative margin would
narrow the positive one — the gap is the constraint, not the position within
it. What this changes is the standing of the alternative: a relative rule
(best-vs-rest margin) does not depend on the gap staying wide, and this is the
first real evidence that the gap is narrower than CP3's five hand-checks
suggested.

**What would settle it:** the same measurement once the teacher's POSITIVE
queries land, and once a second subject or document format is in the corpus. If
the gap narrows again on either axis, the absolute floor is not durable and
D23 should resolve toward the relative rule.

**A caveat that must travel with these numbers:** the 0.69 floor was FITTED on
author-generated queries and is being scored against a set that is still mostly
those same queries. The measurement is optimistic, and the true gap is at best
this wide. The suite prints that provenance beside the result on every run.

**Also recorded — a near-miss worth keeping.** The first candidate for this
negative was *"parts of speech in third term"*, which looked like an ideal
within-subject case. It is in fact a strong POSITIVE: the scheme reviews all
eight parts of speech across Third Term weeks 2, 3 and 4. Filed as a negative
it would have asserted the opposite of the truth, and since negatives are
GATED it would have failed correct retrieval — or pressured the floor downward
to "fix" it. Caught only by checking the fixture rather than trusting the
label. That is the third confirmed mislabelling of this corpus (after the week
7/9 debate and the unsatisfiable precision metric), and the first involving a
label that did not originate with the author: **every label gets verified
against the source, including a teacher's.**

**Provenance is NOT flipped by any of this.** Only two items arrived — this
negative, and a week label confirming that the author's parts-of-speech query
means First Term week 1 (it is ambiguous across four candidate weeks). All six
POSITIVE queries remain the author's own wording, and the positives are what
the gate scores. `QUERY_SET_PROVENANCE` stays `"author-generated"`, the
CP4-IS-NOT-CLOSED banner keeps printing, and CP4 stays open.

#### D27 — Document-verbatim positives, quoted not rephrased (2026-09-04)

Further free-text teacher input was not readily available, so the positive
query set was rebuilt from the already-parsed, already-verified JSS3 English
document. **The queries quote the document verbatim. They are deliberately NOT
rephrased into more natural language.**

**Why quoting beats rephrasing, given the choice.** Rephrasing the document's
topic text into "what a teacher would type" is an act performed by the system's
own author, guessing at natural phrasing — the exact circularity D22 exists to
break, and the same move that produced two prior labelling errors (the week 7/9
debate, and a parts-of-speech query ambiguous across four weeks). It would also
have produced approximately the set that already existed, while wearing a
stronger claim: *derived from verified ground truth*. Same evidence quality,
higher apparent authority, which is the worst direction for a label to move.

Quoting is honest instead of flattering. A verbatim query shares its exact
tokens with the target chunk, so a hit shows the pipeline is **wired up**, not
that the embedding **understands** the topic. That is a real thing to test —
it is a regression check on chunking, embedding, top-K and the floor — and its
labels are ground truth with no author judgement in them. It is simply not
evidence about semantic retrieval, and the suite now says so in those words.

**Three bands, reported separately, because an aggregate over them is
misleading.** Each query carries a `source`, and the eval prints per-band
hit@K rather than letting the easy band carry the headline number:

| band | n | hit@1 | hit@5 | nearest-distance range |
|---|---|---|---|---|
| `document-verbatim` (labels are ground truth, phrasing is the corpus's) | 14 | 13/14 | **14/14** | 0.457 – 0.655 |
| `author-paraphrase` (the only semantic signal; weakest provenance) | 6 | 3/6 | **5/6** | 0.465 – 0.679 |
| negatives — author, cross-subject (weak by construction) | 2 | — | 0/2 rejected ✓ | 0.810 – 0.812 |
| negative — **teacher, within-subject** | 1 | — | 0/1 rejected ✓ | 0.721 |

**The band gap is the finding.** Verbatim scores 93% hit@1; paraphrase scores
50%. The aggregate — 16/20, 80% — would have overstated semantic performance
by a wide margin and hidden which band was carrying it. This is precisely why
the bands are not averaged.

**A second D23 datum, and it points the same way as §14.7.** The worst
*verbatim* positive sits at 0.655 — a query quoted word-for-word out of the
corpus, only 0.035 inside the 0.69 floor. Together with the teacher negative at
0.721, even the easy band leaves a 0.066 gap. An absolute floor that a verbatim
self-quote nearly fails is thin, and this is now the second independent
observation pushing D23 toward the relative rule.

**A latent false-pass, found and fixed by this work.** `expectedWeeks` held
bare week numbers (`"WEEK 2"`) matched by SUBSTRING. This corpus has three
`WEEK 2`s and two `WEEK 1`s across terms, so a bare label silently accepts the
wrong term's chunk as a hit. It had not yet fired only because five of six
placeholders were First Term. Labels are now FULL heading paths
(`"First Term > WEEK 2"`) matched by EQUALITY. Found only because the
document-derived positives span all three terms and made the collision
unavoidable — a real bug surfaced by broadening coverage.

**The teacher's negative is untouched and must stay that way.** No
document-derived negatives were added, deliberately: a correct rejection cannot
be derived from a document that does not contain the topic, and the attempt is
actively dangerous — the first within-subject candidate, "parts of speech in
third term", was in fact a strong positive (§14.7).

**Provenance is NOT `teacher-supplied` and the gate does NOT promote to
`error`.** A new marker value, `document-derived`, was added precisely so this
set can be described accurately without overstating it: labels ground-truth,
phrasing the document's own, **no positive query written by a teacher**. Only a
teacher-phrased positive set clears the banner. CP4 therefore remains open, and
if it is ever closed on this basis the claim must be narrowed in writing to
what it actually establishes: *retrieval returns the correct week for verbatim
and author-paraphrased topics* — not that real teacher phrasing retrieves
correctly.

---

## 15. CP5 plan-first — the curriculum review gate

Written 2026-09-04. Requested directly: after a teacher uploads or pastes a
scheme of work, the system should show them what it understood and let them
**correct it before saving**, so a mismatch is caught by the person who knows
the document rather than discovered later inside a lesson plan.

**Scope:** a human-approval gate between chunking and embedding, with a review
screen a teacher can actually use. Decisions D28–D35.

**Shipping constraint, stated first because it shapes every decision below: a
teacher must be able to use this the day it ships.** Not a schema plus an
endpoint with the UI to follow. The slice is only done when a teacher can
upload a document, see the term/week/topic structure the system extracted, fix
a wrong heading, drop a junk section, approve, and immediately generate a
grounded lesson plan from it. Anything that does not serve that path is out of
this checkpoint.

### 15.1 Why this is the right gate, and why now

This is not a new principle — it is closing an inconsistency. `CLAUDE.md`
requires that AI output is never auto-finalised, and the Smart Student Import
rule already states that an extraction "never writes to a student record
without explicit human confirmation." Curriculum ingestion is currently the
one extraction path in this system that **auto-finalises**: parse, chunk,
embed, mark READY, no human in the loop.

The evidence that it matters is unusually direct. The chunker mis-derived
headings on the first real document **twice** (D13/D14), in ways no synthetic
fixture caught, and both were found only because a human looked at the output
and said that isn't right. Today that inspection is accidental — it depends on
someone noticing that "17 sections" looks wrong. This makes it structural.

**A second, non-obvious payoff: this generates CP4's missing ground truth.**
Every approval is a teacher confirming a topic-to-week mapping — the exact
artifact D22 has been blocked on, arriving as a byproduct of normal use rather
than as a favour asked of a busy teacher. It does **not** close D22 on its own:
approval confirms LABELS, not how a teacher PHRASES a search, so
`QUERY_SET_PROVENANCE` still cannot read `teacher-supplied` on this basis. But
it converts the label half of the problem from "chase someone" into "read what
the product already recorded." D31 makes that an explicit design requirement
rather than a hoped-for side effect.

### 15.2 The lifecycle change

```
  before:  PENDING -> PROCESSING -----------------------> READY | FAILED
  after:   PENDING -> PROCESSING -> AWAITING_REVIEW -> EMBEDDING -> READY | FAILED
                                          ^                |
                                          +--- teacher edits, approves
```

Two properties fall out of this for free, and both are worth naming:

- **Retrieval needs no change.** `CurriculumRetrievalService` already filters
  `status = 'READY'`, so a document awaiting review is invisible to lesson
  planning without a single line changing in the retrieval path. The gate is
  enforced by a status the retriever already respects.
- **`READY` starts carrying a stronger guarantee**: not merely "embedded" but
  "a human confirmed this structure."

### 15.3 Decisions

#### D28 — The gate sits between chunking and embedding, not after embedding

Embed only what a human has approved.

The reason is not only cost discipline. D15 embeds **heading + content**, so
every heading a teacher corrects invalidates that chunk's vector. Embedding
first would mean paying for vectors, discarding them on the first correction,
and recomputing — with a window in which a document holds embeddings that no
longer match its own headings. Gating first means a badly-parsed document never
consumes embedding budget at all, and a corrected heading is embedded exactly
once, correctly.

This also splits the existing worker in two: `parse+chunk` (ends at
AWAITING_REVIEW) and `embed+finalise` (triggered by approval). Both remain
`tenantWorker`-wrapped jobs on the existing queue, dispatched by job name — the
one-processor-per-queue convention this repo already follows.

#### D29 — Draft chunks persist in `curriculum_chunks` with a NULLABLE embedding

The alternative considered was holding the draft chunk set as JSONB on the
document and materialising rows only on approval. That preserves a clean
invariant ("a chunk row is always retrievable") but it means a loose blob
needing its own validating parser, a second representation of the same shape,
and edit logic that rewrites a blob rather than updating rows.

Making `embedding` nullable is simpler and lets the review screen read chunks
through ordinary tenant-scoped queries with RLS already doing its work. The
invariant is preserved at the DOCUMENT level instead: a document only reaches
`READY` when every one of its chunks has an embedding, and retrieval filters on
that status. The embed step asserts it explicitly rather than assuming it, and
the retrieval SQL adds `embedding IS NOT NULL` as a belt-and-braces guard —
cheap, and it means a future query that forgets the status filter still cannot
return an unembedded chunk.

HNSW simply does not index NULL rows, so the vector index is unaffected.

#### D30 — The teacher edits HEADINGS and discards CHUNKS. Content is not editable.

Two operations, deliberately:

1. **Correct a heading path** — term, week, topic. This is where every real
   defect has appeared: `ENGLISH` repeated eight times, `TABLE OF CONTENT` as a
   heading, a term precedence bug putting weeks under the wrong term.
2. **Discard a chunk** — the front matter, the contents page, the recommended-
   textbooks page. Real documents carry material that is not curriculum, and
   the honest fix is to drop it, not to label it.

**Editing chunk CONTENT is deliberately excluded from v1.** It turns a
verification step into a document editor, and it lets a teacher silently
rewrite the source of truth so that what is embedded no longer matches the file
the school actually holds. If a document's *text* is wrong, the right repair is
re-uploading a better file, not retyping it into a review screen. Revisit only
if real use shows a case this refusal blocks.

#### D31 — Approval is recorded as data, because it is CP4's ground truth

`reviewedBy` and `reviewedAt` on the document, plus an `audit_logs` row — the
same treatment any other human-confirmation gate in this system gets.

But the requirement is stronger than provenance bookkeeping: the approved
**heading set** must be readable afterwards as a topic-to-week mapping a
teacher stands behind. Concretely, after approval the system can answer "which
week does this school's JSS3 English scheme place *Idiomatic Expressions* in?"
with an answer a human confirmed. That is CP4's labelled data, and building the
review screen without capturing it in that form would waste the one chance to
get it as a byproduct.

Also recorded: **whether the teacher changed anything, and what.** A document
approved with zero edits is evidence the chunker got it right; a document with
six heading corrections is evidence it did not. That is the first real
measurement of chunker quality on documents nobody on this project has seen —
worth strictly more than any synthetic fixture, and it costs one extra column.

#### D32 — Paste-as-text is a first-class input alongside file upload

The request named "uploads/pastes" and the paste path is worth having on its
own merits: it skips PDF parsing entirely, which is the most failure-prone
component in the pipeline (a cross-document leak in `pdf-parse`, an ESM/CJS
loader problem, a MediaBox clipping bug — all real, all found here). A teacher
who can paste their scheme into a textarea gets a working feature without
depending on any of it.

Implementation cost is genuinely small: the same chunker, the same review
screen, the same approval path; only the parse step is skipped and
`storageKey` becomes optional for pasted documents. **If this checkpoint comes
under scope pressure, this is the first thing to drop** — but it should not
need to be.

#### D33 — No new permission. Coarse `curriculum.upload` guard, ownership asserted in the service.

Approving a document is not a distinct authority from uploading one — someone
trusted to add curriculum is trusted to confirm it parsed correctly. Adding
`curriculum.review` would mean a permission migration and a role-grant backfill
for no real access-control gain.

The substantive check lives in the service layer, exactly as the ownership-
scoped delete does: the uploader may approve their own document; an admin may
approve any within the school. This is the established division in this
codebase — coarse `@Permissions` guard, substantive assertion in the service —
and reusing it keeps the two curriculum write paths consistent with each other.

#### D34 — Existing READY documents are grandfathered, not retro-gated

There is one real document in production (the JSS3 English scheme). It is
already embedded and has in fact been human-inspected more thoroughly than this
gate will ever inspect anything. Migrating it back to `AWAITING_REVIEW` would
break grounding for a live user to satisfy a formality.

Existing documents stay `READY` with `reviewedAt` NULL — and **that NULL is
meaningful, not missing data**: it distinguishes "approved by a human through
the gate" from "predates the gate." Any future analysis of chunker quality
(D31) must exclude NULL-reviewed documents rather than treating them as
zero-edit approvals, which would silently flatter the chunker.

#### D35 — No auto-expiry of AWAITING_REVIEW in v1

A document can sit unreviewed forever. The failure mode is a teacher uploading,
being interrupted, and later wondering why lesson planning finds nothing.

The v1 answer is **visibility, not expiry**: the curriculum list shows an
explicit "Needs your review" state, and the lesson-plan grounding notice — which
already explains when generation was not grounded (D20) — names an awaiting-
review document as the reason when one exists for that subject and class level.
That converts a silent gap into a signposted next action.

Auto-expiring or auto-approving after a timeout is rejected outright: the first
destroys work a teacher may return to, and the second defeats the entire point
of the gate.

### 15.4 Shape

```
packages/db/prisma/schema.prisma          + AWAITING_REVIEW, EMBEDDING statuses
                                          + reviewedBy/reviewedAt/editCount
                                          embedding -> nullable
packages/db/prisma/migrations/<new>/      the above, additive and guarded
packages/types/src/curriculum/            review + approve DTOs (Zod)
apps/api/.../curriculum.service.ts        listForReview, updateChunkHeading,
                                          discardChunk, approve (ownership-scoped)
apps/api/.../curriculum.controller.ts     GET    /curriculum/documents/:id/review
                                          PATCH  /curriculum/documents/:id/chunks/:chunkId
                                          DELETE /curriculum/documents/:id/chunks/:chunkId
                                          POST   /curriculum/documents/:id/approve
                                          POST   /curriculum/documents/paste
apps/api/.../curriculum.processor.ts      split: parse+chunk | embed+finalise
apps/web/src/app/(teacher)/curriculum/    the review screen — the deliverable
```

### 15.5 The vertical slice, spelled out

Done means a teacher can, unaided:

1. Upload a PDF **or paste text**, and land on a review screen rather than a
   spinner that ends in silence.
2. See every extracted section as **Term > Week > Topic**, in document order,
   with its text.
3. **Fix a wrong heading** inline and **discard a junk section**.
4. **Approve**, and watch the document become usable.
5. Generate a lesson plan that cites the sections they just approved.

Step 5 is the acceptance test. A review screen that does not end in a grounded
lesson plan has not shipped the feature — it has shipped a form.

### 15.6 Tests

- Service specs: approval is ownership-scoped (uploader or admin only, and a
  teacher from another school gets nothing); a document cannot be approved
  twice; a chunk cannot be edited once its document is `READY`.
- RLS spec extension: a draft chunk with a NULL embedding is subject to exactly
  the same tenant isolation as an embedded one — the new nullable column must
  not open a hole.
- Retrieval spec: an `AWAITING_REVIEW` document is invisible to retrieval, and
  a chunk with a NULL embedding is never returned even if its document status
  is tampered with.
- E2E: upload -> review -> edit a heading -> discard a chunk -> approve ->
  generate a grounded lesson plan citing the edited heading. This is the
  slice's acceptance test and it is not optional.

### 15.7 What CP5 does NOT do

- **It does not verify that the document is a good scheme of work.** It
  verifies that the system read it correctly. A teacher approving a poorly
  written scheme gets faithful grounding in a poor scheme.
- **It does not fix chunking.** It makes chunking errors visible and
  correctable, and it starts measuring how often they happen (D31). The
  measurement is the input to any future chunker work — including the sub-row
  granularity question CP4 raised and deliberately left open.
- **It does not close D22.** Approval confirms labels, not query phrasing.

### 15.8 Estimate

**3–4 days.** The API and worker split are straightforward — the pipeline
already has a status lifecycle and a tenant-scoped worker to extend. The review
screen is the bulk of it, and the E2E test is the part most likely to expose
something unforeseen, as it did in CP2.

### 15.9 Built — 2026-09-04

Shipped as planned, with three deviations, all recorded here rather than
silently absorbed.

**Deviation 1: D32 was already done.** Paste-as-text shipped in CP2 as "the D6
escape hatch" — a first-class `POST /curriculum/documents/paste` endpoint with
its own tab in the upload form. The plan proposed building what already
existed. No work was needed and none was done.

**Deviation 2: draft chunks are written in the REQUEST, not by a worker.** The
plan had upload queue a parse job that ended at `AWAITING_REVIEW`. But parsing
and chunking already happened in the request — the per-document and per-school
caps are denominated in chunks, so the count has to be known before the upload
can be accepted at all. Writing those chunks in the same transaction costs one
bounded insert and removes an entire polling stage from the critical path: the
teacher lands on the review screen with content on it, instead of watching a
spinner for work that had already finished. Only embedding is queued now, and
only after approval.

**Deviation 3: the enum change needed its own migration.** `ALTER TYPE ... ADD
VALUE` is permitted inside a transaction, but PostgreSQL refuses to let the new
value be USED in that same transaction, and the partial index for the review
queue has `WHERE status = 'AWAITING_REVIEW'` in its predicate. Kept together
the pair would have failed on a fresh database while appearing to work on one
where the enum already had the values — the worst kind of migration bug.
`20260904100000_phase_7_cp5_review_statuses` therefore contains nothing but the
two `ADD VALUE` statements, and must stay that way.

**One addition beyond the plan: `awaiting-review` as a grounding reason.** D35
promised the lesson-plan grounding notice would name an unreviewed document
rather than staying silent. Delivering that needed a new `RetrievalReason`,
because `no-documents` and `awaiting-review` are indistinguishable from inside
retrieval — neither returns chunks — but they are OPPOSITE instructions to the
teacher reading them. One says "upload a scheme of work"; the other says "you
already did, go and confirm it". A teacher who uploaded five minutes ago being
told to upload again would be the most confusing thing this feature could say.

#### What was verified, and how

Against a **real PostgreSQL**, not a mock:

- Both migrations applied cleanly with `prisma migrate deploy` — which is what
  actually proves deviation 3's split was necessary rather than cautious.
- **97/97 curriculum tests pass**, including 13 new ones.
- **1,870 API tests pass, 0 failures.** Full monorepo: 13/13 packages green,
  plus `pnpm lint` 9/9 and `pnpm typecheck` 14/14.

**The single most important test** is `embed.handler.spec.ts`'s first case:
*embeds the TEACHER'S corrected heading, not the parser's original.*

It earns that place because the failure it guards against is silent and total.
The review screen could work perfectly — the teacher fixes a wrong heading, the
row updates, the UI shows the correction, the document goes READY — and if the
embed step re-derived its chunks from the stored source file, every correction
would be discarded at the last moment and the parser's mistakes embedded
anyway. Nothing else in the system would notice, because the chunk rows would
still display the corrected text; only the vectors would disagree with them.

That is not a hypothetical: re-deriving from source is exactly what the
pre-CP5 handler did, deliberately and for good reasons. Those reasons INVERT
once a human is allowed to correct the chunks, and the spec pins the inversion.

#### Known gap: no browser E2E in CI

The plan called the upload → review → edit → approve → grounded-plan E2E "the
slice's acceptance test and not optional". **It is not in CI, and the reason is
structural rather than a shortcut being taken.**

CI has no `VOYAGE_API_KEY` — it passes a placeholder Anthropic key and no
embedding key at all. `EmbeddingService.isConfigured()` is therefore false in
CI, and the very first step of the flow refuses with `CURRICULUM_NOT_CONFIGURED`
before a document is ever created. A Playwright spec would not partially cover
the flow; it would be skipped or red on every run.

What covers the flow instead, and what does not:

- **Covered against a real database**: the gate's authorisation, the
  edit/discard operations and their counters, the refusal to edit an approved
  document, the refusal to approve twice, the refusal to embed an unapproved
  document, resume-without-re-spending, rate-limit survival, and — the crux —
  that the teacher's corrected heading is what reaches the vendor.
- **NOT covered**: that the browser wiring holds end to end. The API contract
  is tested; the click path is not.

That gap closes with a manual pass against a deployment that has real keys, and
it should be done before this is announced to a school. It is a real gap and is
recorded as one rather than being reported as covered.
