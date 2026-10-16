import { SIMILARITY, type SimilaritySegmentDto } from "@school-kit/types";

// Phase 9 / CP4.4 — the similarity check (docs/modules/phase-9.md §11 CP4-D9).
//
// Every pair of typed answers is compared on overlapping runs of five words
// ("shingles"). Runs that also appear in the homework's own title,
// instructions or questions are dropped first, so quoting the question is not
// counted. A pair is listed when at least half of the SHORTER answer's runs
// are in the other one — containment rather than Jaccard, so an answer copied
// whole into a longer one still shows. Answers under 50 words are skipped.
//
// Pure functions, no database: what goes in is the text, what comes out is
// the pairs and the shared passages. Nothing here is stored.

interface Word {
  key: string;
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

export function words(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.normalize("NFC").matchAll(WORD)) {
    out.push({ key: m[0].toLowerCase(), start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

function shingleKeys(list: readonly Word[]): string[] {
  const keys: string[] = [];
  for (let i = 0; i + SIMILARITY.shingleWords <= list.length; i++) {
    keys.push(
      list
        .slice(i, i + SIMILARITY.shingleWords)
        .map((w) => w.key)
        .join(" "),
    );
  }
  return keys;
}

/** The runs of the homework's own wording; any answer quoting them isn't counted for it. */
export function promptShingles(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const k of shingleKeys(words(t))) out.add(k);
  return out;
}

export interface Answer {
  studentId: string;
  text: string;
}

interface Prepared {
  answer: Answer;
  words: Word[];
  /** Run start position → key, prompt runs removed. */
  runs: Map<number, string>;
  keys: Set<string>;
}

function prepare(answer: Answer, prompt: ReadonlySet<string>): Prepared {
  // The text the teacher reads is the NFC text, so positions line up with it.
  const text = answer.text.normalize("NFC");
  const list = words(text);
  const runs = new Map<number, string>();
  shingleKeys(list).forEach((k, i) => {
    if (!prompt.has(k)) runs.set(i, k);
  });
  return { answer: { ...answer, text }, words: list, runs, keys: new Set(runs.values()) };
}

/** The answer cut into stretches, the ones whose wording the other answer shares marked. */
export function segmentsOf(p: Prepared, shared: ReadonlySet<string>): SimilaritySegmentDto[] {
  const marked = new Array<boolean>(p.words.length).fill(false);
  for (const [i, k] of p.runs) {
    if (!shared.has(k)) continue;
    for (let j = i; j < i + SIMILARITY.shingleWords; j++) marked[j] = true;
  }
  const out: SimilaritySegmentDto[] = [];
  const push = (text: string, flag: boolean) => {
    if (text === "") return;
    const last = out[out.length - 1];
    if (last && last.shared === flag) last.text += text;
    else out.push({ text, shared: flag });
  };
  let cursor = 0;
  p.words.forEach((w, i) => {
    // The gap before a word is shared only inside a shared stretch.
    push(p.answer.text.slice(cursor, w.start), i > 0 && marked[i - 1]! && marked[i]!);
    push(p.answer.text.slice(w.start, w.end), marked[i]!);
    cursor = w.end;
  });
  push(p.answer.text.slice(cursor), false);
  return out;
}

export interface SimilarPair {
  overlapPercent: number;
  a: { studentId: string; segments: SimilaritySegmentDto[] };
  b: { studentId: string; segments: SimilaritySegmentDto[] };
}

export interface SimilarityResult {
  compared: number;
  skippedShort: number;
  pairs: SimilarPair[];
}

export function findSimilarPairs(answers: readonly Answer[], prompt: ReadonlySet<string>): SimilarityResult {
  const prepared: Prepared[] = [];
  let skippedShort = 0;
  for (const a of answers) {
    const p = prepare(a, prompt);
    if (p.words.length < SIMILARITY.minWords) skippedShort++;
    else prepared.push(p);
  }
  const found: (SimilarPair & { ratio: number })[] = [];
  for (let i = 0; i < prepared.length; i++) {
    for (let j = i + 1; j < prepared.length; j++) {
      const a = prepared[i]!;
      const b = prepared[j]!;
      const smaller = Math.min(a.keys.size, b.keys.size);
      if (smaller === 0) continue;
      const shared = new Set([...a.keys].filter((k) => b.keys.has(k)));
      const ratio = shared.size / smaller;
      if (ratio < SIMILARITY.threshold) continue;
      found.push({
        ratio,
        overlapPercent: Math.round(ratio * 100),
        a: { studentId: a.answer.studentId, segments: segmentsOf(a, shared) },
        b: { studentId: b.answer.studentId, segments: segmentsOf(b, shared) },
      });
    }
  }
  found.sort((x, y) => y.ratio - x.ratio);
  return {
    compared: prepared.length,
    skippedShort,
    pairs: found.slice(0, SIMILARITY.maxPairs).map((p) => ({ overlapPercent: p.overlapPercent, a: p.a, b: p.b })),
  };
}
