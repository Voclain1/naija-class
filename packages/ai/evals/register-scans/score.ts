// Scoring for the register-scan accuracy pass (docs/deferred.md item 5,
// docs/modules/smart-student-import.md §8).
//
// Pure: no I/O, no model. The live runner (./run.ts) feeds it real output and
// hand-checked ground truth; the offline case (../cases/register-scan-scoring.ts)
// pins its behaviour on synthetic rows so `pnpm ai:eval` gates it without a key.
//
// WHAT IT COUNTS, AND WHY THE CATEGORIES ARE NOT JUST RIGHT/WRONG
//
// D6 says the model must never guess. So a field it could not read and said
// so about (null + listed in unreadableFields) is a SAFE miss: the review grid
// shows the admin an empty, flagged cell. A field it got wrong while sounding
// sure is a SILENT error: it looks right in the grid and may never be caught.
// Those two are not the same failure and must never be added together. The
// number that decides whether the feature can be switched on is the silent
// one.
//
//   correct    value matches the page (or both are absent)
//   flagged    the page has a value; the model returned null and flagged it
//   missed     the page has a value; the model returned null WITHOUT a flag
//   wrong      the page has a value; the model returned a different value  ← silent
//   invented   the page has nothing; the model returned a value            ← silent
//
// A field the human checker could not read either (`illegible` in the ground
// truth) is correct only as null + flag; any value there counts as invented,
// because nobody can vouch for it.

export const SCORED_FIELDS = [
  "admissionNumber",
  "firstName",
  "middleName",
  "lastName",
  "dateOfBirth",
  "gender",
  "classArm",
  "guardianName",
  "guardianPhone",
] as const;
export type ScoredField = (typeof SCORED_FIELDS)[number];

/** One row as the model returned it (STUDENT_LIST_EXTRACTION_SCHEMA). */
export type ExtractedRow = Record<ScoredField, string | null> & { unreadableFields: string[] };

/**
 * One row of hand-checked ground truth: what is actually written on the page.
 * null = the page has nothing there. `illegible` = fields where something is
 * written that the checker could not read either.
 */
export type TruthRow = Record<ScoredField, string | null> & { illegible?: string[] };

export type Outcome = "correct" | "flagged" | "missed" | "wrong" | "invented";

export interface FieldTally {
  correct: number;
  flagged: number;
  missed: number;
  wrong: number;
  invented: number;
}

export interface PageScore {
  truthRows: number;
  extractedRows: number;
  /** Ground-truth rows with no extracted row paired to them: the model skipped them. */
  droppedRows: number;
  /** Extracted rows with no ground-truth row: the model made a row up or split one. */
  extraRows: number;
  fields: Record<ScoredField, FieldTally>;
}

export function emptyTally(): FieldTally {
  return { correct: 0, flagged: 0, missed: 0, wrong: 0, invented: 0 };
}

function emptyFields(): Record<ScoredField, FieldTally> {
  return Object.fromEntries(SCORED_FIELDS.map((f) => [f, emptyTally()])) as Record<ScoredField, FieldTally>;
}

/**
 * Whitespace is the only thing normalised. Case, punctuation, hyphens and
 * spelling are compared exactly: the prompt says "transcribe exactly", and
 * "Okafor-Nwosu" read as "Okafor Nwosu" is a different name on a record.
 */
export function normalise(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const v = value.trim().replace(/\s+/g, " ");
  return v === "" ? null : v;
}

export function scoreField(field: ScoredField, truth: TruthRow, got: ExtractedRow): Outcome {
  const expected = normalise(truth[field]);
  const actual = normalise(got[field]);
  const flaggedByModel = got.unreadableFields.includes(field);
  const illegibleOnPage = truth.illegible?.includes(field) ?? false;

  if (illegibleOnPage) {
    if (actual !== null) return "invented";
    return flaggedByModel ? "correct" : "missed";
  }
  if (expected === null) return actual === null ? "correct" : "invented";
  if (actual === null) return flaggedByModel ? "flagged" : "missed";
  return actual === expected ? "correct" : "wrong";
}

// ---------------------------------------------------------------------------
// Row alignment.
//
// Pairing rows by index is wrong the moment the model skips or splits one:
// every row after it would be scored against its neighbour and the page would
// read as a wall of "wrong". So rows are aligned in page order by name
// similarity (a Needleman–Wunsch pass with free gaps), and only pairs that
// look like the same child are scored. Unpaired rows are counted as dropped or
// extra, which is the honest description of what happened.
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j]!;
      prev[j] = Math.min(above + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = above;
    }
  }
  return prev[b.length]!;
}

function rowKey(row: { firstName: string | null; lastName: string | null; admissionNumber: string | null }): string {
  return [row.admissionNumber, row.firstName, row.lastName]
    .map((v) => normalise(v)?.toLowerCase() ?? "")
    .join(" ")
    .trim();
}

/** 0..1. Two rows below MIN_PAIR_SIMILARITY are treated as different children. */
export function rowSimilarity(truth: TruthRow, got: ExtractedRow): number {
  const a = rowKey(truth);
  const b = rowKey(got);
  if (a === "" || b === "") return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

export const MIN_PAIR_SIMILARITY = 0.5;

/** Pairs of [truthIndex, extractedIndex], in page order. */
export function alignRows(truth: readonly TruthRow[], got: readonly ExtractedRow[]): Array<[number, number]> {
  const n = truth.length;
  const m = got.length;
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = rowSimilarity(truth[i - 1]!, got[j - 1]!);
      const pair = sim >= MIN_PAIR_SIMILARITY ? best[i - 1]![j - 1]! + sim : -Infinity;
      best[i]![j] = Math.max(best[i - 1]![j]!, best[i]![j - 1]!, pair);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const sim = rowSimilarity(truth[i - 1]!, got[j - 1]!);
    if (sim >= MIN_PAIR_SIMILARITY && best[i]![j] === best[i - 1]![j - 1]! + sim) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (best[i]![j] === best[i - 1]![j]) {
      i--;
    } else {
      j--;
    }
  }
  return pairs.reverse();
}

export function scorePage(truth: readonly TruthRow[], got: readonly ExtractedRow[]): PageScore {
  const pairs = alignRows(truth, got);
  const fields = emptyFields();
  for (const [t, g] of pairs) {
    for (const field of SCORED_FIELDS) {
      fields[field][scoreField(field, truth[t]!, got[g]!)] += 1;
    }
  }
  return {
    truthRows: truth.length,
    extractedRows: got.length,
    droppedRows: truth.length - pairs.length,
    extraRows: got.length - pairs.length,
    fields,
  };
}

export function addScores(a: PageScore, b: PageScore): PageScore {
  const fields = emptyFields();
  for (const field of SCORED_FIELDS) {
    for (const k of Object.keys(fields[field]) as Outcome[]) {
      fields[field][k] = a.fields[field][k] + b.fields[field][k];
    }
  }
  return {
    truthRows: a.truthRows + b.truthRows,
    extractedRows: a.extractedRows + b.extractedRows,
    droppedRows: a.droppedRows + b.droppedRows,
    extraRows: a.extraRows + b.extraRows,
    fields,
  };
}

export function emptyPageScore(): PageScore {
  return { truthRows: 0, extractedRows: 0, droppedRows: 0, extraRows: 0, fields: emptyFields() };
}

export function silentErrors(t: FieldTally): number {
  return t.wrong + t.invented;
}

export function scoredCells(t: FieldTally): number {
  return t.correct + t.flagged + t.missed + t.wrong + t.invented;
}

// ---------------------------------------------------------------------------
// The bar for switching the feature on.
//
// A PROPOSAL, written down so the accuracy pass has a yes/no answer rather
// than a feeling; the owner can move it. It is stricter on the fields that
// become a child's permanent record and are hard to spot as wrong in review.
// ---------------------------------------------------------------------------

export interface Verdict {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

const NAME_FIELDS: readonly ScoredField[] = ["firstName", "middleName", "lastName"];

export function verdicts(total: PageScore): Verdict[] {
  const sum = (fs: readonly ScoredField[], pick: (t: FieldTally) => number) =>
    fs.reduce((n, f) => n + pick(total.fields[f]), 0);

  const nameCells = sum(NAME_FIELDS, scoredCells);
  const nameSilent = sum(NAME_FIELDS, silentErrors);
  const allCells = sum(SCORED_FIELDS, scoredCells);
  const allCorrect = sum(SCORED_FIELDS, (t) => t.correct);
  const admissionInvented = total.fields.admissionNumber.invented + total.fields.admissionNumber.wrong;
  const phoneSilent = silentErrors(total.fields.guardianPhone);
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);

  return [
    {
      name: "no admission number is wrong or invented",
      passed: admissionInvented === 0,
      detail: `${admissionInvented} silent admission-number error(s)`,
    },
    {
      name: "names: silent errors at most 1% of name cells",
      passed: nameCells > 0 && nameSilent / nameCells <= 0.01,
      detail: `${nameSilent} of ${nameCells} (${pct(nameSilent, nameCells)})`,
    },
    {
      name: "guardian phone: no silent errors",
      passed: phoneSilent === 0,
      detail: `${phoneSilent} silent phone error(s)`,
    },
    {
      name: "no row dropped or made up",
      passed: total.droppedRows === 0 && total.extraRows === 0,
      detail: `${total.droppedRows} dropped, ${total.extraRows} extra`,
    },
    {
      name: "overall: at least 90% of cells right without the admin typing",
      passed: allCells > 0 && allCorrect / allCells >= 0.9,
      detail: `${allCorrect} of ${allCells} (${pct(allCorrect, allCells)})`,
    },
  ];
}
