// Phase 7 / CP2 — structural chunking for curriculum documents (D7).
//
// A scheme of work is not prose. It has natural units — term, week, topic —
// and those units are what a teacher recognises. So this chunker's primary
// strategy is to split on DETECTED HEADINGS and carry the heading path onto
// each chunk, falling back to a fixed token window with overlap only where no
// structure can be found.
//
// Why the heading path matters more than it looks: it is what makes a
// retrieved chunk CITABLE. "Term 1 > Week 5 > Photosynthesis" is a reference a
// teacher can check against the physical document on their desk; a naked
// paragraph is not. CP3's grounding display (D10) shows these strings, so a
// bad heading path degrades trust in retrieval even when the retrieval itself
// is correct.
//
// TOKEN COUNTS HERE ARE ESTIMATES, deliberately. Voyage does not publish a
// tokeniser, and pulling in a wrong one (tiktoken is OpenAI's BPE) would give
// confident numbers that are quietly incorrect. The ~4-chars-per-token
// heuristic is documented as approximate at every point it is used, and every
// consumer treats it as a BUDGET to stay under rather than a measurement:
// batching leaves headroom, and the ledger records the vendor's OWN reported
// token count, never this estimate.

/** Approximate characters per token. English prose sits near 4. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimated token count. Approximate by construction — see the header. Used
 * for budgeting (how much to put in a chunk, how much to put in a batch),
 * never for billing, which always uses the vendor's reported count.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface ChunkingOptions {
  /** Hard ceiling per chunk. A section over this is split by window. */
  readonly maxTokens?: number;
  /**
   * Chunks smaller than this are merged forward into their neighbour. A
   * three-word chunk ("Week 6") embeds to near-noise and pollutes retrieval
   * with a result that carries no information.
   */
  readonly minTokens?: number;
  /**
   * Overlap between windows when a section is too large to fit in one chunk.
   * Exists so a sentence spanning a window boundary is still wholly present in
   * at least one chunk — without it, the single most relevant sentence in a
   * long section can end up split across two chunks and retrieved in neither.
   */
  readonly overlapTokens?: number;
}

export const CHUNK_DEFAULTS = {
  maxTokens: 500,
  minTokens: 40,
  overlapTokens: 60,
} as const;

export interface Chunk {
  /** Position in the source document. Stable ordering for display. */
  readonly ordinal: number;
  /** Detected heading path, e.g. "Term 1 > Week 5 > Photosynthesis". */
  readonly heading: string | null;
  readonly content: string;
  /** Estimated — see estimateTokens. */
  readonly tokenCount: number;
}

// ---------------------------------------------------------------------------
// Heading detection
// ---------------------------------------------------------------------------

interface DetectedHeading {
  readonly level: number;
  readonly text: string;
}

// Patterns are ordered most-specific first. Each carries a LEVEL, which is
// what lets headings nest into a path rather than a flat list.
//
// The vocabulary here is deliberately Nigerian-scheme-of-work specific — the
// documents this will actually meet say "FIRST TERM" and "WEEK 5", not
// "Chapter" and "Section". A generic heading detector would score worse on the
// only corpus that matters.
const HEADING_RULES: ReadonlyArray<{
  readonly test: RegExp;
  readonly level: number;
}> = [
  // "FIRST TERM", "TERM 1", "SECOND TERM" — the outermost unit.
  { test: /^\s*(FIRST|SECOND|THIRD)\s+TERM\b/i, level: 1 },
  { test: /^\s*TERM\s+(ONE|TWO|THREE|[123])\b/i, level: 1 },
  // "WEEK 5", "WEEKS 5-6", "WEEK 5:" — the unit a teacher plans against.
  { test: /^\s*WEEKS?\s+\d+(\s*[-–]\s*\d+)?\s*[:.-]?/i, level: 2 },
  // "SUB-TOPIC:" must be tested before "TOPIC:" or it matches the latter.
  { test: /^\s*SUB[-\s]?TOPIC\s*[:-]/i, level: 4 },
  { test: /^\s*TOPIC\s*[:-]/i, level: 3 },
];

function detectHeading(line: string): DetectedHeading | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  // A "heading" that runs on for a paragraph is a sentence that happens to
  // start with a keyword. Real headings are short.
  if (trimmed.length > 120) return null;

  // Markdown, if the source was converted from one. Level is the # count.
  const md = /^(#{1,6})\s+(.*)$/.exec(trimmed);
  if (md?.[1] && md[2] !== undefined) {
    const text = md[2].trim();
    return text.length > 0 ? { level: md[1].length, text } : null;
  }

  // Numbered outline: "1.", "1.2", "1.2.3" — level from the dot depth.
  const numbered = /^(\d+(?:\.\d+)*)[.)]\s+(.*)$/.exec(trimmed);
  if (numbered?.[1] && (numbered[2] ?? "").trim().length > 0) {
    return { level: numbered[1].split(".").length, text: trimmed };
  }

  for (const rule of HEADING_RULES) {
    if (rule.test.test(trimmed)) {
      return { level: rule.level, text: stripTrailingPunctuation(trimmed) };
    }
  }

  // An ALL-CAPS short line with no sentence-ending punctuation is
  // conventionally a heading in these documents. Guarded tightly: it must
  // contain a letter, be short, and not end like a sentence — otherwise a
  // shouted sentence in the body becomes a spurious section break.
  if (
    trimmed.length <= 60 &&
    /[A-Z]/.test(trimmed) &&
    trimmed === trimmed.toUpperCase() &&
    !/[.!?]$/.test(trimmed)
  ) {
    return { level: 1, text: stripTrailingPunctuation(trimmed) };
  }

  return null;
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[\s:]+$/, "");
}

/** Joined heading path from a stack, e.g. "Term 1 > Week 5". */
function pathOf(stack: readonly DetectedHeading[]): string | null {
  if (stack.length === 0) return null;
  return stack.map((h) => h.text).join(" > ");
}

// ---------------------------------------------------------------------------
// Windowing — the fallback when a section will not fit
// ---------------------------------------------------------------------------

/**
 * Split text into overlapping windows, breaking at sentence or line
 * boundaries where one exists near the target. Breaking mid-sentence is the
 * behaviour to avoid: it produces a chunk whose last clause is unreadable and
 * whose embedding is correspondingly muddled.
 */
function windowText(text: string, maxTokens: number, overlapTokens: number): string[] {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = Math.min(overlapTokens * CHARS_PER_TOKEN, Math.floor(maxChars / 2));
  if (text.length <= maxChars) return [text];

  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      // Look back over the last 30% of the window for a clean break.
      const searchFrom = start + Math.floor(maxChars * 0.7);
      const slice = text.slice(searchFrom, end);
      const breakAt = Math.max(
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("! "),
      );
      if (breakAt > 0) end = searchFrom + breakAt + 1;
    }
    const piece = text.slice(start, end).trim();
    if (piece.length > 0) out.push(piece);
    if (end >= text.length) break;
    // Step forward by the window minus the overlap, but ALWAYS make progress —
    // without the max() a pathological break position could loop forever.
    start = Math.max(end - overlapChars, start + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chunker
// ---------------------------------------------------------------------------

interface Section {
  heading: string | null;
  lines: string[];
}

/**
 * Chunk a curriculum document.
 *
 * Strategy, in order:
 *   1. Split into sections on detected headings, maintaining a heading STACK
 *      so nested headings produce a path rather than only the nearest one.
 *   2. Emit one chunk per section where it fits under maxTokens.
 *   3. Window oversized sections with overlap, repeating the heading on each
 *      window so every piece stays citable.
 *   4. Merge undersized chunks forward, so "Week 6" alone never becomes a
 *      chunk of its own.
 *
 * A document with NO detectable headings degrades to step 3 over the whole
 * text — which is exactly the fixed-window fallback D7 calls for, reached
 * without needing a separate code path.
 */
export function chunkDocument(raw: string, options: ChunkingOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? CHUNK_DEFAULTS.maxTokens;
  const minTokens = options.minTokens ?? CHUNK_DEFAULTS.minTokens;
  const overlapTokens = options.overlapTokens ?? CHUNK_DEFAULTS.overlapTokens;

  const text = normalise(raw);
  if (text.trim().length === 0) return [];

  // ---- 1. sections -------------------------------------------------------
  const sections: Section[] = [];
  const stack: DetectedHeading[] = [];
  let current: Section = { heading: null, lines: [] };

  const closeCurrent = (): void => {
    if (current.heading !== null || current.lines.some((l) => l.trim().length > 0)) {
      sections.push(current);
    }
  };

  for (const line of text.split("\n")) {
    const heading = detectHeading(line);
    if (!heading) {
      current.lines.push(line);
      continue;
    }
    closeCurrent();
    // Pop to the parent level, then push. This is what turns a flat sequence
    // of headings into a nested path.
    while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= heading.level) {
      stack.pop();
    }
    stack.push(heading);
    current = { heading: pathOf(stack), lines: [] };
  }
  closeCurrent();

  // ---- 2 & 3. emit, windowing where needed -------------------------------
  const draft: Array<{ heading: string | null; content: string }> = [];
  for (const section of sections) {
    const content = section.lines.join("\n").trim();
    if (content.length === 0) {
      // A heading with no body of its own. Kept as a placeholder so step 4 can
      // decide whether it merges forward; never emitted as a chunk.
      draft.push({ heading: section.heading, content: "" });
      continue;
    }
    if (estimateTokens(content) <= maxTokens) {
      draft.push({ heading: section.heading, content });
      continue;
    }
    for (const win of windowText(content, maxTokens, overlapTokens)) {
      draft.push({ heading: section.heading, content: win });
    }
  }

  // ---- 4. merge undersized chunks forward --------------------------------
  const merged: Array<{ heading: string | null; content: string }> = [];
  for (const piece of draft) {
    if (piece.content.length === 0) continue;

    const prev = merged[merged.length - 1];
    const canMerge =
      prev !== undefined &&
      estimateTokens(piece.content) < minTokens &&
      estimateTokens(prev.content) + estimateTokens(piece.content) <= maxTokens;

    if (canMerge) {
      prev.content = (prev.content + "\n" + piece.content).trim();
      continue;
    }
    merged.push({ ...piece });
  }

  return merged.map((c, i) => ({
    ordinal: i,
    heading: c.heading,
    content: c.content,
    tokenCount: estimateTokens(c.content),
  }));
}

/**
 * Normalise whitespace before chunking. PDF text extraction in particular
 * produces \r\n, non-breaking spaces, and runs of blank lines from page
 * furniture; leaving those in makes heading detection miss and inflates the
 * token estimate.
 */
function normalise(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n");
}
