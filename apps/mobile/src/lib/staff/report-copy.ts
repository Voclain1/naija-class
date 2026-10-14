import { formatHundredths } from "@school-kit/types";

// Phase 9 / CP1.3b — words for the analytics summaries. Hundredths become
// text here and nowhere else on the phone.

/** 9333 → "93.33%"; null → "—". */
export function pct(hundredths: number | null): string {
  return hundredths === null ? "—" : `${formatHundredths(hundredths)}%`;
}

/** +1000 → "up 10.00 since last term"; null (no earlier term) → null. */
export function changeSince(hundredths: number | null): string | null {
  if (hundredths === null) return null;
  if (hundredths === 0) return "no change since last term";
  return `${hundredths > 0 ? "up" : "down"} ${formatHundredths(Math.abs(hundredths))} since last term`;
}

/** "12 students" / "1 student". */
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
