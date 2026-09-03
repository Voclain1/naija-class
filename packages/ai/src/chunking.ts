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
  /** Estimated — see estimateTokens. Covers the EMBEDDED text (see embeddableText). */
  readonly tokenCount: number;
}

/**
 * The exact text that gets embedded for a chunk — heading included (D15).
 *
 * Retrieval is over ONE vector per chunk, so anything not inside this string
 * cannot influence similarity at all. Until CP3 the heading was stored but
 * never embedded, which meant "WEEK 5" and "First Term" — precisely the terms a
 * teacher's query uses — appeared nowhere in the vector. That was defensible
 * while headings were meaningless; D13/D14 made them real.
 *
 * ONE function, used by both ingestion and any re-embedding backfill, because
 * a corpus embedded content-only and one embedded heading-plus-content are not
 * comparable: mixing them makes a distance threshold mean different things for
 * different rows. If these two paths ever computed the string differently the
 * symptom would be silently degraded retrieval, not an error.
 */
export function embeddableText(chunk: Pick<Chunk, "heading" | "content">): string {
  return chunk.heading ? `${chunk.heading}\n\n${chunk.content}` : chunk.content;
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
  //
  // The third pattern is the TABLE-ROW form, "Term  Second Term", and it is
  // load-bearing rather than cosmetic. In the real document each term's table
  // opens with that row while the decorative "Second Term" banner extracts
  // AFTER the table it heads. Detecting only the banner attributed every week
  // to the PREVIOUS term — second-term content cited as "First Term > WEEK 2",
  // which is worse than carrying no term at all.
  { test: /^\s*(FIRST|SECOND|THIRD)\s+TERM\b/i, level: LEVEL.TERM },
  { test: /^\s*TERMS?\s+(FIRST|SECOND|THIRD)\s+TERM\b/i, level: LEVEL.TERM },
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
  // Must carry an actual word. The real scheme of work contains the line
  // "11. –" (a week RANGE whose second number wrapped to the next line), which
  // otherwise matched this rule and became a heading reading "11. –".
  if (numbered?.[1] && /[A-Za-z]/.test(numbered[2] ?? "")) {
    return { level: numbered[1].split(".").length, text: trimmed };
  }

  for (const rule of HEADING_RULES) {
    if (rule.test.test(trimmed)) {
      return { level: rule.level, text: cleanHeadingText(trimmed) };
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

/**
 * A table cell that wrapped onto the next line, e.g.
 *
 *     LITERATURE IN
 *     ENGLISH
 *
 * Text extraction emits each wrapped line separately, so a two-line cell
 * arrives as two lines. Joining them is what turns the fragments this chunker
 * used to emit — "ENGLISH", "ABULARY", "1 REVISION OF LAST" — back into the
 * phrases a teacher would recognise.
 *
 * Only ALL-CAPS lines are joined, and only to other ALL-CAPS lines. In these
 * documents the topic column is consistently capitalised while the breakdown
 * column is sentence case, so this rejoins cells without ever swallowing body
 * text. A line with no letters ("11. –", "12") is never joined, so a week
 * number cannot absorb the row beneath it.
 */
function joinWrappedCapsLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];

  const isCapsFragment = (line: string): boolean => {
    const t = line.trim();
    if (t.length === 0 || t.length > 60) return false;
    if (!/[A-Z]/.test(t)) return false;
    if (t !== t.toUpperCase()) return false;
    // A finished sentence is not a wrapped cell.
    return !/[.!?]$/.test(t);
  };

  // A line the heading rules already recognise is STRUCTURE, not a wrapped
  // cell, and must never be absorbed into its neighbour. Without this the
  // cover block
  //     VIRGO FIDELIS SECONDARY SCHOOL / FIRST TERM SCHEME OF WORK / SUBJECT: …
  // collapsed into one long line and the term was swallowed whole — trading
  // the bug this function fixes for a worse one.
  const isStructural = (line: string): boolean =>
    HEADING_RULES.some((rule) => rule.test.test(line.trim()));

  for (const line of lines) {
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      isCapsFragment(prev) &&
      isCapsFragment(line) &&
      !isStructural(prev) &&
      !isStructural(line)
    ) {
      out[out.length - 1] = `${prev.trim()} ${line.trim()}`;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Leading ALL-CAPS tokens of a table row — the topic cell.
 *
 * Tokenising rather than regex-matching a character class, because the
 * boundary that matters is where capitalisation STOPS: in
 * "SPEECH WORK The Schwa / ə / sound", the topic is "SPEECH WORK" and the
 * breakdown begins at "The". A token is part of the topic while it is
 * capitalised and contains a letter.
 */
function leadingCapsPhrase(rest: string): { topic: string; body: string } | null {
  const tokens = rest.split(/\s+/);
  const taken: string[] = [];
  for (const token of tokens) {
    if (!/[A-Z]/.test(token) || token !== token.toUpperCase()) break;
    taken.push(token);
  }
  if (taken.length === 0) return null;

  const topic = taken.join(" ").replace(/[,;:.\s]+$/, "");
  if (topic.length < 3 || topic.length > MAX_TOPIC_CHARS) return null;
  return { topic, body: tokens.slice(taken.length).join(" ").trim() };
}

const MAX_TOPIC_CHARS = 90;

/**
 * Rewrite tabular week rows into the line shape the heading rules understand.
 *
 * Grounded in the real document (a Lagos State unified scheme of work
 * distributed as a syllabus.ng ebook, examined 2026-09-03) rather than in a
 * reconstruction. Its table extracts like this:
 *
 *     Week Topic Breakdown
 *     1 REVISION OF LAST
 *     TERM'S EXAMINATION
 *     GRAMMAR Parts of speech – Revision
 *     READING AND
 *     COMPREHENSION
 *     Scanning for main points
 *
 * Three properties of that shape do the work here:
 *
 *   1. The table announces its own columns ("Week Topic Breakdown"), which is
 *      the guard — nothing is rewritten in a document without it.
 *   2. A week row begins with its NUMBER, optionally a range ("5-10").
 *   3. The topic cell is ALL-CAPS while the breakdown cell is sentence case,
 *      so the topic ends exactly where capitalisation stops.
 *
 * Note there is NO minimum row length. An earlier version required 120+
 * characters after the number, to separate content rows from contents-page
 * entries. Against the real document that was simply wrong: rows are SHORT
 * ("1 REVISION OF LAST", "10 REVISION"), so recovery never fired. The
 * all-caps-topic requirement is the better discriminator, and it is what
 * excludes "2 Chapter Two" and "3 Chapter Three" — title case, not caps.
 */
function recoverTabularWeekRows(text: string): { text: string; recovered: boolean } {
  if (!WEEK_TABLE_HEADER.test(text)) return { text, recovered: false };

  let recovered = false;
  const out: string[] = [];

  for (const line of text.split("\n")) {
    const match = /^(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s+(.+)$/.exec(line.trim());
    if (match?.[1] && match[3]) {
      const from = Number(match[1]);
      const to = match[2] ? Number(match[2]) : null;
      // Bounded by a plausible term length; a "week 47" is a row number.
      if (from >= 1 && from <= 15 && (to === null || (to >= from && to <= 15))) {
        // The caps phrase VALIDATES the row (it is what distinguishes
        // "2 SPEECH WORK …" from "2 Chapter Two"), but it is deliberately NOT
        // promoted into the heading.
        //
        // A week's row carries only its FIRST aspect — week 5 reads
        // "5 SPEECH WORK …" and then continues with grammar, comprehension,
        // composition and literature in the rows beneath it. Citing the chunk
        // as "WEEK 5 > TOPIC: SPEECH WORK" would attach a claim the chunk does
        // not honour: a teacher who retrieved the modal-verbs passage would see
        // it labelled "speech work". "WEEK 5" alone is precise, checkable
        // against the document, and says nothing untrue.
        //
        // The topic text stays in the BODY, so retrieval still matches on it.
        if (leadingCapsPhrase(match[3]) !== null) {
          out.push(to === null ? `WEEK ${from}` : `WEEK ${from}-${to}`);
          out.push(match[3]);
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

/**
 * Tidy a detected heading for display in a citation.
 *
 * Currently one rule: collapse the table-row form "Term  Second Term" to
 * "Second Term". The row is how the document labels its term, but repeating
 * the column name in the path ("Term Second Term > WEEK 3") reads as a
 * transcription artefact rather than a reference.
 */
function cleanHeadingText(text: string): string {
  const termRow = /^\s*TERMS?\s+((?:FIRST|SECOND|THIRD)\s+TERM)\b/i.exec(text);
  if (termRow?.[1]) return termRow[1];
  return stripTrailingPunctuation(text);
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
  // Wrapped cells are rejoined FIRST: everything downstream reasons about
  // lines, and a two-line cell is not two lines of meaning. Repeated-line
  // counting then runs on the joined text, so it sees "LITERATURE IN ENGLISH"
  // rather than a stray "ENGLISH" fragment.
  const joined = joinWrappedCapsLines(normalised);
  const repeated = findRepeatedLines(joined);
  const { text, recovered } = recoverTabularWeekRows(joined);

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
    // Estimated over the EMBEDDED text, not the content alone. tokenCount
    // feeds batch budgeting, and since D15 the heading is part of what is sent
    // — counting only the content would let batches quietly exceed the
    // per-request budget by the size of every heading in them.
    tokenCount: estimateTokens(embeddableText(c)),
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
