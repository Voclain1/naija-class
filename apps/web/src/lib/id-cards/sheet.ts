// An A4 sheet of ID cards: two across, five down.
export const PER_SHEET = 10;

/**
 * The back sheet's order: each row's two cards swap sides, so a double-sided
 * print flipped on the long edge puts every back behind its own front.
 */
export function mirrorRows<T>(sheet: (T | null)[]): (T | null)[] {
  const out: (T | null)[] = [];
  for (let i = 0; i < PER_SHEET; i += 2) out.push(sheet[i + 1] ?? null, sheet[i] ?? null);
  return out;
}
