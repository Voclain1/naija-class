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

// Heading LEVELS. Explicit constants rather than inline numbers because their
// RELATIVE ORDER is the whole mechanism: a heading pops every open heading at
// its own level or deeper, so the numbers decide what nests inside what.
//
// TERM sits above GENERIC deliberately (fixed 2026-09-02). Previously both were
// level 1, so a cover block reading
//     FIRST TERM SCHEME OF WORK / SUBJECT: ENGLISH / CLASS: JSS 2
// ended with CLASS popping FIRST TERM, and every week nested under "CLASS: JSS 2"
// with the term lost. The term is the outermost real unit of a scheme of work
// and must outrank an unclassified capitalised line.
const LEVEL = {
  TERM: 1,
  /** An all-caps line we cannot classify — the loosest rule, so the weakest claim. */
  GENERIC: 2,
  WEEK: 3,
  TOPIC: 4,
  SUB_TOPIC: 5,
} as const;

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
  { test: /^\s*(FIRST|SECOND|THIRD)\s+TERM\b/i, level: LEVEL.TERM },
  { test: /^\s*TERM\s+(ONE|TWO|THREE|[123])\b/i, level: LEVEL.TERM },
  // "WEEK 5", "WEEKS 5-6", "WEEK 5:" — the unit a teacher plans against.
  { test: /^\s*WEEKS?\s+\d+(\s*[-–]\s*\d+)?\s*[:.-]?/i, level: LEVEL.WEEK },
  // "SUB-TOPIC:" must be tested before "TOPIC:" or it matches the latter.
  { test: /^\s*SUB[-\s]?TOPIC\s*[:-]/i, level: LEVEL.SUB_TOPIC },
  { test: /^\s*TOPIC\s*[:-]/i, level: LEVEL.TOPIC },
];

/**
 * A table-of-contents entry: "1 COMPREHENSION 2", "12 Revision 14".
 *
 * Rejected as a heading. These are all-caps often enough to pass the generic
 * rule, and a contents page therefore used to contribute a handful of headings
 * that name a topic but point at nothing — observed on Virgo Fidelis's JSS2
 * English scheme, where the contents page produced "1 COMPREHENSION 2".
 */
const TOC_ENTRY = /^\d{1,3}\s+.*\s\d{1,3}$/;

function detectHeading(
  line: string,
  repeated: ReadonlySet<string>,
  suppressGeneric: boolean,
): DetectedHeading | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  // A "heading" that runs on for a paragraph is a sentence that happens to
  // start with a keyword. Real headings are short.
  if (trimmed.length > 120) return null;

  // RUNNING PAGE FURNITURE IS NEVER A HEADING.
  //
  // The failure this fixes, observed on a real document: a scheme of work with
  // "ENGLISH" printed at the top of every page produced eight identical
  // "ENGLISH" headings — one per page — because text extraction concatenates
  // pages and the generic all-caps rule fired on each occurrence. Every chunk
  // was then labelled with the subject name, which tells a teacher nothing
  // about WHICH part of the scheme the content came from.
  //
  // Note what this does NOT do: it does not delete the line. A repeated line
  // stays in the body text, so no content is lost — the only thing withdrawn
  // is its claim to be a section boundary. Deleting would risk stripping
  // genuinely repeated CONTENT (per-week boilerplate like a standard
  // evaluation line), which is a much worse failure than a noisy chunk.
  if (repeated.has(trimmed)) return null;

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
  //
  // This is the LOOSEST rule here and the one that has actually misfired in
  // production, so it now makes the weakest claim it can: LEVEL.GENERIC, below
  // TERM, and never on a contents-page entry.
  if (
    trimmed.length <= 60 &&
    /[A-Z]/.test(trimmed) &&
    trimmed === trimmed.toUpperCase() &&
    !/[.!?]$/.test(trimmed) &&
    !TOC_ENTRY.test(trimmed) &&
    // In a TABLE-shaped document the unclassifiable capitalised lines are page
    // furniture and contents-page titles, not structure — so once row recovery
    // has found real weeks, this rule has nothing left to contribute and only
    // does harm. Without this, weeks recovered from a table nested under
    // "TABLE OF CONTENT", producing paths that point at the wrong page.
    !suppressGeneric
  ) {
    return { level: LEVEL.GENERIC, text: stripTrailingPunctuation(trimmed) };
  }

  return null;
}

/**
 * Short lines occurring often enough to be page furniture rather than
 * structure — a running header or footer repeated on every page.
 *
 * Threshold of 3 rather than 2: a genuine topic can legitimately recur twice in
 * a term (a scheme revisiting "COMPREHENSION" in weeks 1 and 7), and demoting
 * that would lose a real heading. Three identical short lines in one document
 * is furniture.
 */
const FURNITURE_MIN_OCCURRENCES = 3;
const FURNITURE_MAX_LINE_CHARS = 80;

function findRepeatedLines(text: string): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > FURNITURE_MAX_LINE_CHARS) continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  const repeated = new Set<string>();
  for (const [line, n] of counts) {
    if (n >= FURNITURE_MIN_OCCURRENCES) repeated.add(line);
  }
  return repeated;
}

// ---------------------------------------------------------------------------
// Tabular week rows
// ---------------------------------------------------------------------------

/**
 * Many real schemes of work are TABLES — week, topic, objectives, activities,
 * materials, evaluation across columns. PDF text extraction flattens a table
 * into one line per row, so "WEEK 3" never appears alone and the WEEK rule
 * above never fires. Observed on Virgo Fidelis's JSS2 English scheme: 17
 * chunks, not one of them carrying a week.
 *
 * The recovery works because two things survive flattening:
 *
 *   1. The row begins with its WEEK NUMBER — a bare leading integer.
 *   2. The table announces its own columns in a header line ("Week Topic
 *      Objectives ..."), which is what makes this safe to attempt at all.
 *
 * Without (2) this would be a blanket "any line starting with a digit is a
 * week", which would mangle numbered lists and price tables in any other
 * document. The column header is the guard, and no rewriting happens without
 * it.
 *
 * Deliberately NOT x/y layout analysis on pdf.js text items. That is the
 * general solution and it is a genuinely larger piece of work; this handles the
 * shape real schemes of work actually take, and does nothing at all when it
 * does not recognise one.
 */
const WEEK_TABLE_HEADER = /^[^\n]{0,20}\bweeks?\b[^\n]{0,40}\btopics?\b/im;

/** A contents-page row is short; a real content row carries the week's whole plan. */
const MIN_CONTENT_ROW_CHARS = 120;
const MAX_TOPIC_WORDS = 10;
const MAX_TOPIC_CHARS = 90;

/** Clause openers that mark where the topic column ends and objectives begin. */
const OBJECTIVE_OPENER =
  /\b(?:by the end|pupils?\s+(?:should|will|are)|students?\s+(?:should|will|are)|teacher\s|the teacher\b|learning objective|objective[s]?\s*[:-])/i;

function splitTopicFromRow(rest: string): { topic: string; body: string } | null {
  let head = rest;

  // Prefer an explicit objective opener; fall back to the first sentence break;
  // fall back again to a word cap. Real topics are short noun phrases
  // ("Grammar: Nouns and Their Types"), so a cap is a reasonable last resort.
  const opener = OBJECTIVE_OPENER.exec(head);
  if (opener && opener.index > 2) head = head.slice(0, opener.index);

  const period = head.indexOf(". ");
  if (period > 2) head = head.slice(0, period);

  const words = head.trim().split(/\s+/);
  if (words.length > MAX_TOPIC_WORDS) head = words.slice(0, MAX_TOPIC_WORDS).join(" ");

  const consumed = head.length;
  const topic = head.trim().replace(/[,;:.\s]+$/, "");
  if (topic.length < 3 || topic.length > MAX_TOPIC_CHARS) return null;

  return { topic, body: rest.slice(consumed).trim() };
}

/**
 * Rewrite flattened table rows into the line shape the heading rules already
 * understand. A row becomes three lines: "WEEK n", "TOPIC: ...", then the rest
 * of the row as body.
 *
 * Rewriting the TEXT rather than adding a fourth heading rule is deliberate —
 * it keeps one code path for heading detection, so a recovered week nests,
 * paths, and merges exactly like a natively-formatted one.
 */
function recoverTabularWeekRows(text: string): { text: string; recovered: boolean } {
  if (!WEEK_TABLE_HEADER.test(text)) return { text, recovered: false };

  let recovered = false;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const match = /^(\d{1,2})\s+(.+)$/.exec(trimmed);
    const rest = match?.[2]?.trim() ?? "";

    if (match?.[1] && rest.length >= MIN_CONTENT_ROW_CHARS) {
      const week = Number(match[1]);
      // Bounded by a plausible term length. A "week 47" is a row number or a
      // price, not a week.
      if (week >= 1 && week <= 15) {
        const split = splitTopicFromRow(rest);
        if (split) {
          out.push(`WEEK ${week}`);
          out.push(`TOPIC: ${split.topic}`);
          if (split.body.length > 0) out.push(split.body);
          recovered = true;
          continue;
        }
      }
    }
    out.push(line);
  }
  return { text: out.join("\n"), recovered };
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

  const normalised = normalise(raw);
  if (normalised.trim().length === 0) return [];

  // ---- 0. repair what text extraction destroyed --------------------------
  // Both steps exist because of one real document (Virgo Fidelis, JSS2
  // English, 2026-09-02) whose 17 chunks carried 16 headings that were all
  // useless: "ENGLISH" eight times, plus contents-page fragments, and not one
  // week among them. The two causes were independent and BOTH had to be fixed —
  // stripping the furniture alone leaves the headings meaningless, it just
  // changes which noise wins.
  //
  // Order matters: repeated lines are counted on the ORIGINAL text, before row
  // recovery inserts new "WEEK n" lines that are unique by construction.
  const repeated = findRepeatedLines(normalised);
  const { text, recovered } = recoverTabularWeekRows(normalised);

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
    const heading = detectHeading(line, repeated, recovered);
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
