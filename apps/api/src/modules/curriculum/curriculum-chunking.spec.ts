import { describe, expect, it } from "vitest";

import {
  CHUNK_DEFAULTS,
  chunkDocument,
  estimateTokens,
  planEmbeddingBatches,
  planTotals,
} from "@school-kit/ai";

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
