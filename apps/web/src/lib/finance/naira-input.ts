// What a bursar types into a naira box ("5000", "5,000.50", "₦1,200") turned
// into kobo, with string arithmetic only — no float ever touches the money.
// Null for anything that is not a positive amount with at most two decimals.
export function nairaInputToKobo(input: string): number | null {
  const cleaned = input.replace(/[₦,\s]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const naira = Number(match[1]);
  const kobo = Number((match[2] ?? "").padEnd(2, "0"));
  const total = naira * 100 + kobo;
  return Number.isSafeInteger(total) && total > 0 ? total : null;
}

// The other way, for pre-filling a naira box from a saved kobo amount
// ("15000000" -> "150000", "12345" -> "123.45"). Integer arithmetic only.
export function koboToNairaInput(kobo: number): string {
  const naira = Math.floor(kobo / 100);
  const rest = kobo % 100;
  return rest === 0 ? String(naira) : `${naira}.${String(rest).padStart(2, "0")}`;
}
