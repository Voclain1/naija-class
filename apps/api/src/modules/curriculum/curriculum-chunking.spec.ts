import { describe, expect, it } from "vitest";

import {
  CHUNK_DEFAULTS,
  chunkDocument,
  estimateTokens,
  planEmbeddingBatches,
  planTotals,
} from "@school-kit/ai";

import { REAL_TEXT as REAL_SCHEME_TEXT } from "./__fixtures__/real-scheme-of-work";

// Phase 7 / CP2 — chunking and batch planning.
//
// These are pure functions and they are where retrieval quality is actually
// decided, so they get real assertions about SHAPE rather than smoke tests.
// A chunker that silently drops the last section, or a batch planner that
// reorders inputs, both produce a corpus that retrieves confident wrong
// answers rather than failing — the hardest class of bug to notice later.

const SCHEME = `
FIRST TERM SCHEME OF WORK
Basic Science, JSS 2

WEEK 1
TOPIC: Living and Non-living Things
Pupils should be able to list five characteristics of living things and give
three examples of each category found around the school compound.

WEEK 5
TOPIC: Photosynthesis
Pupils should be able to state the word equation for photosynthesis and name
the raw materials required. Teacher demonstrates with a potted plant kept in
the dark for 48 hours.

SUB-TOPIC: Conditions necessary
Sunlight, chlorophyll, carbon dioxide and water. Pupils record observations in
their notebooks and answer the evaluation questions at the end of the chapter.

WEEK 12
TOPIC: Revision
Revise all topics treated during the term in preparation for the examination.
`;

describe("chunkDocument — structural chunking (D7)", () => {
  it("splits on headings and builds a NESTED heading path", () => {
    const chunks = chunkDocument(SCHEME);
    expect(chunks.length).toBeGreaterThan(1);

    // The sub-topic must inherit its week, not replace it — a chunk labelled
    // only "Conditions necessary" is not a reference a teacher can act on.
    const sub = chunks.find((c) => c.heading?.includes("Conditions necessary"));
    expect(sub).toBeDefined();
    expect(sub!.heading).toContain("FIRST TERM");
    expect(sub!.heading).toContain("WEEK 5");
    expect(sub!.heading).toContain("TOPIC: Photosynthesis");
    expect(sub!.content).toContain("chlorophyll");
  });

  it("keeps a week's body with that week, not the neighbouring one", () => {
    const chunks = chunkDocument(SCHEME);
    const week5 = chunks.filter((c) => c.heading?.includes("WEEK 5"));
    const week1 = chunks.filter((c) => c.heading?.includes("WEEK 1"));

    expect(week5.some((c) => c.content.includes("word equation"))).toBe(true);
    // The photosynthesis content must NOT have leaked into week 1.
    expect(week1.some((c) => c.content.includes("word equation"))).toBe(false);
  });

  it("assigns contiguous ordinals starting at 0", () => {
    const chunks = chunkDocument(SCHEME);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("LOSES NO CONTENT — every non-heading line survives into some chunk", () => {
    // The failure this guards against is a chunker that drops the final
    // section, which is invisible in a spot check and silently truncates every
    // school's last week of every term.
    const chunks = chunkDocument(SCHEME);
    const joined = chunks.map((c) => c.content).join("\n");
    for (const phrase of [
      "five characteristics",
      "word equation",
      "potted plant",
      "chlorophyll",
      "preparation for the examination",
    ]) {
      expect(joined).toContain(phrase);
    }
  });

  it("never emits a chunk over the token ceiling", () => {
    const long = `WEEK 3\nTOPIC: Long\n${"The mitochondrion is the powerhouse of the cell. ".repeat(400)}`;
    const chunks = chunkDocument(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(CHUNK_DEFAULTS.maxTokens);
    }
    // Every window keeps the heading, so an oversized section stays citable.
    expect(chunks.every((c) => c.heading?.includes("WEEK 3"))).toBe(true);
  });

  it("falls back to windowing for a document with NO detectable structure", () => {
    const prose = "the quick brown fox jumps over the lazy dog. ".repeat(300);
    const chunks = chunkDocument(prose);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.heading === null)).toBe(true);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(CHUNK_DEFAULTS.maxTokens);
    }
  });

  it("does not emit a chunk for a bare heading with no body", () => {
    // "WEEK 6" alone embeds to near-noise and would pollute every retrieval.
    const chunks = chunkDocument("WEEK 6\n\nWEEK 7\nTOPIC: Real content here.\n" + "x".repeat(400));
    expect(chunks.every((c) => c.content.trim().length > 0)).toBe(true);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(chunkDocument("")).toEqual([]);
    expect(chunkDocument("   \n\n  \t ")).toEqual([]);
  });

  it("treats a long ALL-CAPS SENTENCE as body, not a heading", () => {
    // The all-caps rule is the loosest heading heuristic and the one most
    // likely to misfire on a shouted instruction inside the body text.
    const text =
      "WEEK 2\nTOPIC: Safety\nPUPILS MUST NOT TOUCH THE BUNSEN BURNER WITHOUT SUPERVISION AT ANY TIME.\nFurther notes follow here to give the section a body of reasonable length for chunking purposes.";
    const chunks = chunkDocument(text);
    const headings = chunks.map((c) => c.heading ?? "");
    expect(headings.some((h) => h.includes("BUNSEN"))).toBe(false);
    expect(chunks.map((c) => c.content).join(" ")).toContain("BUNSEN");
  });
});

// ---------------------------------------------------------------------------
// Real-document regression — the JSS3 English scheme of work, 2026-09-02.
//
// The first real document put through this pipeline ingested cleanly and
// reported 17 sections with 16 non-null headings. Every automated check passed.
// The headings were nonetheless useless: "ENGLISH" eight times, contents-page
// fragments, and not one week among them.
//
// THE LESSON IS ABOUT THE TEST AS MUCH AS THE CODE. The original suite asserted
// that headings were NON-NULL. That is the wrong property: a heading repeated
// eight times is non-null and worthless, while null would at least have been an
// honest signal. These assert DISTINCTNESS and INFORMATIVENESS instead, against
// the document's REAL extracted text — see the fixture's header for why a
// transcribed fixture replaced two reconstructed ones.
// ---------------------------------------------------------------------------

describe("chunkDocument — the real JSS3 scheme of work", () => {
  const chunks = chunkDocument(REAL_SCHEME_TEXT);

  const headingCounts = (): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const c of chunks) {
      if (c.heading) counts.set(c.heading, (counts.get(c.heading) ?? 0) + 1);
    }
    return counts;
  };

  it("does NOT label chunks with a repeated wrapped-cell fragment", () => {
    // The exact production symptom. "ENGLISH" was never a page header — it is
    // the second line of the wrapped cell "LITERATURE IN / ENGLISH", which
    // recurs in every week of every term.
    const counts = headingCounts();
    expect([...counts.keys()]).not.toContain("ENGLISH");
    expect([...counts.keys()]).not.toContain("COMPREHENSION");
    expect([...counts.keys()]).not.toContain("ABULARY");
  });

  it("gives every chunk a DISTINCT heading", () => {
    const counts = headingCounts();
    for (const [heading, n] of counts) {
      expect(n, `heading "${heading}" repeats ${n} times`).toBe(1);
    }
  });

  it("RECOVERS the week from wrapped tabular rows", () => {
    const weekBearing = chunks.filter((c) => /WEEK\s*\d/i.test(c.heading ?? ""));
    // Was zero. Most of the document is week rows, so most chunks carry one.
    expect(weekBearing.length).toBeGreaterThan(chunks.length / 2);
  });

  it("attributes weeks to the RIGHT term", () => {
    // The term's table-row label precedes its table; the decorative banner
    // FOLLOWS it. Detecting only the banner put second-term weeks under
    // "First Term" — a citation that points at the wrong page.
    const secondTermWeeks = chunks.filter((c) => c.heading?.startsWith("Second Term >"));
    const thirdTermWeeks = chunks.filter((c) => c.heading?.startsWith("Third Term >"));
    expect(secondTermWeeks.length).toBeGreaterThan(0);
    expect(thirdTermWeeks.length).toBeGreaterThan(0);

    // Content check, not just a label check: second-term week 1 is about
    // folktales, which appears in no other term.
    const folktales = chunks.find((c) => /folktales/i.test(c.content));
    expect(folktales?.heading).toContain("Second Term");
  });

  it("never roots a path at the CONTENTS PAGE", () => {
    expect(chunks.some((c) => /TABLE OF CONTENT\s*>/i.test(c.heading ?? ""))).toBe(false);
  });

  it("does not put the week's FIRST ASPECT in the path as if it were the topic", () => {
    // A week row names only its first aspect ("5 SPEECH WORK ..."), then
    // continues with grammar, comprehension, composition and literature.
    // "WEEK 5 > TOPIC: SPEECH WORK" would mislabel the modal-verbs passage.
    expect(chunks.some((c) => /TOPIC: SPEECH WORK/i.test(c.heading ?? ""))).toBe(false);
    // ...but the topic text is still in the body, so retrieval matches on it.
    expect(chunks.some((c) => /SPEECH WORK/i.test(c.content))).toBe(true);
  });

  it("does not mistake chapter numbering for a week", () => {
    // "2 Chapter Two" and "3 Chapter Three" lead with a digit like a week row.
    // Title case rather than caps is what excludes them.
    expect(chunks.some((c) => /Chapter (Two|Three)/i.test(c.heading ?? ""))).toBe(false);
  });

  it("LOSES NO CONTENT from the real document", () => {
    const joined = chunks.map((c) => c.content).join("\n");
    for (const phrase of [
      "Parts of speech",
      "The Schwa",
      "All that glitters is",
      "child trafficking",
      "Review of Monotones",
      "Recommended Textbooks",
    ]) {
      expect(joined, `lost: ${phrase}`).toContain(phrase);
    }
  });
});

describe("chunkDocument — heading quality invariants", () => {
  it("keeps the TERM as the root of the path, above unclassified capitalised lines", () => {
    // Regression: FIRST TERM was popped by "SUBJECT:" / "CLASS:" on the cover
    // block, so every week nested under "CLASS: JSS 2" and the term was lost.
    const text =
      "VIRGO FIDELIS SECONDARY SCHOOL\nFIRST TERM SCHEME OF WORK\nSUBJECT: ENGLISH LANGUAGE\nCLASS: JSS 2\n" +
      "\nWEEK 1\nTOPIC: Comprehension\n" +
      "Pupils should be able to identify topic sentences and answer factual questions on a passage they have read.\n";
    const chunks = chunkDocument(text);
    expect(chunks[0]?.heading).toContain("FIRST TERM");
    expect(chunks[0]?.heading).toContain("WEEK 1");
  });

  it("does not invent weeks in a document with no week table", () => {
    // The row-recovery rewrite is guarded by a "Week ... Topic" column header.
    // Without that guard it would mangle any numbered list.
    const text =
      "SAFEGUARDING POLICY\n" +
      "1 All staff must complete the annual safeguarding training before the start of the academic session, and " +
      "records of completion are held by the school administrator for inspection at any time.\n" +
      "2 Any concern about a child must be reported to the designated safeguarding lead on the same day it arises, " +
      "in writing, using the standard form held in the school office.\n";
    const chunks = chunkDocument(text);
    expect(chunks.some((c) => /WEEK/i.test(c.heading ?? ""))).toBe(false);
  });
});

describe("planEmbeddingBatches — D4a consequence 1", () => {
  const item = (tokens: number, tag: string) => ({
    content: tag,
    tokenCount: tokens,
  });

  it("packs many small items into ONE request rather than one each", () => {
    // The whole point of D4a: a 60-chunk document is one call, not sixty.
    const items = Array.from({ length: 60 }, (_, i) => item(50, `c${i}`));
    const batches = planEmbeddingBatches(items);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.items).toHaveLength(60);
  });

  it("respects the INPUT-count ceiling", () => {
    const items = Array.from({ length: 250 }, (_, i) => item(1, `c${i}`));
    const batches = planEmbeddingBatches(items, { maxInputs: 100, maxTokens: 1_000_000 });
    expect(batches.map((b) => b.items.length)).toEqual([100, 100, 50]);
  });

  it("respects the TOKEN ceiling independently of the input count", () => {
    const items = Array.from({ length: 10 }, (_, i) => item(300, `c${i}`));
    const batches = planEmbeddingBatches(items, { maxInputs: 1000, maxTokens: 1000 });
    for (const b of batches) expect(b.estimatedTokens).toBeLessThanOrEqual(1000);
    expect(planTotals(batches).items).toBe(10);
  });

  it("PRESERVES ORDER across batches", () => {
    // A reordering here misaligns vectors to chunks, which retrieves
    // plausible-looking wrong content instead of failing. Worth its own test.
    const items = Array.from({ length: 37 }, (_, i) => item(100, `c${i}`));
    const batches = planEmbeddingBatches(items, { maxInputs: 7, maxTokens: 1_000_000 });
    const flattened = batches.flatMap((b) => b.items.map((x) => x.content));
    expect(flattened).toEqual(items.map((x) => x.content));
  });

  it("sends an item larger than the whole budget ALONE rather than dropping it", () => {
    const items = [item(10, "a"), item(5_000, "huge"), item(10, "b")];
    const batches = planEmbeddingBatches(items, { maxInputs: 1000, maxTokens: 1000 });
    const solo = batches.find((b) => b.items.length === 1 && b.items[0]!.content === "huge");
    expect(solo).toBeDefined();
    // Nothing was lost.
    expect(planTotals(batches).items).toBe(3);
  });

  it("returns no batches for no items", () => {
    expect(planEmbeddingBatches([])).toEqual([]);
  });
});

describe("estimateTokens", () => {
  it("is documented as approximate and stays in the right order of magnitude", () => {
    // Not asserting a precise value — the point of the heuristic is that it is
    // a budget, not a measurement. Asserting exactness would encode the
    // heuristic's error as a requirement.
    const words = "photosynthesis chlorophyll stomata ".repeat(50);
    const est = estimateTokens(words);
    expect(est).toBeGreaterThan(words.split(/\s+/).length * 0.5);
    expect(est).toBeLessThan(words.split(/\s+/).length * 5);
  });
});
