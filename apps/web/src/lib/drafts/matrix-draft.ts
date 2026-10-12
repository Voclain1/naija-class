// The class-subject matrix's unsaved toggles, as a draft (session-draft.ts).
// Pure, so it is unit-tested under the node-environment runner.

export type MatrixCellIntent = { linked: true; isCore: boolean } | { linked: false };

export interface MatrixDraftCell {
  levelId: string;
  subjectId: string;
  intent: MatrixCellIntent;
}

/** What is saved now for a cell: linked (core or not), or not linked. */
export type MatrixSaved = (levelId: string, subjectId: string) => { isCore: boolean } | null;

function differs(intent: MatrixCellIntent, saved: { isCore: boolean } | null): boolean {
  if (!intent.linked) return saved !== null;
  return saved === null || saved.isCore !== intent.isCore;
}

/** The cells whose intent differs from what is saved: the draft to keep. */
export function matrixDraftCells(
  desired: ReadonlyMap<string, ReadonlyMap<string, MatrixCellIntent>>,
  saved: MatrixSaved,
): MatrixDraftCell[] {
  const cells: MatrixDraftCell[] = [];
  for (const [levelId, perSubject] of desired) {
    for (const [subjectId, intent] of perSubject) {
      if (differs(intent, saved(levelId, subjectId))) cells.push({ levelId, subjectId, intent });
    }
  }
  return cells;
}

/**
 * The draft cells that can come back: their class level and subject still
 * exist, and they would still change something.
 */
export function restorableMatrixCells(
  cells: MatrixDraftCell[],
  levelIds: ReadonlySet<string>,
  subjectIds: ReadonlySet<string>,
  saved: MatrixSaved,
): MatrixDraftCell[] {
  return cells.filter(
    (c) => levelIds.has(c.levelId) && subjectIds.has(c.subjectId) && differs(c.intent, saved(c.levelId, c.subjectId)),
  );
}

/** Cells back into the matrix's overlay shape. */
export function toDesiredMap(cells: MatrixDraftCell[]): Map<string, Map<string, MatrixCellIntent>> {
  const map = new Map<string, Map<string, MatrixCellIntent>>();
  for (const c of cells) {
    const perSubject = map.get(c.levelId) ?? new Map<string, MatrixCellIntent>();
    perSubject.set(c.subjectId, c.intent);
    map.set(c.levelId, perSubject);
  }
  return map;
}
