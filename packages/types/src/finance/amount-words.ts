// Amounts in words, as a Nigerian cheque writes them (2026-09-22).
//
// Shared by the API's branded receipt ("Fifty thousand naira only") and the
// phone's payment confirmation, so a parent's receipt and the bursar's
// confirmation can never word the same amount differently. Moved here from
// apps/mobile/src/lib/staff/money.ts, which now re-exports it.
//
// Integers only: kobo in, words out. No floating point anywhere.

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function underThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) {
    const words =
      rest < 20
        ? (ONES[rest] as string)
        : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${ONES[rest % 10]}` : ""}`;
    parts.push(hundreds > 0 ? `and ${words}` : words);
  }
  return parts.join(" ");
}

/** A whole number in words, British style: 1,250,000 → "one million, two hundred and fifty thousand". */
export function numberInWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("numberInWords takes a non-negative safe integer");
  if (n === 0) return "zero";
  const scales: Array<[number, string]> = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1_000, "thousand"],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, name] of scales) {
    if (rest >= size) {
      parts.push(`${numberInWords(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0) {
    // "one thousand and five", as a Nigerian cheque would write it.
    parts.push(parts.length > 0 && rest < 100 ? `and ${underThousand(rest)}` : underThousand(rest));
  }
  return parts.join(", ").replace(/, and /g, " and ");
}

/** 5000050 → "fifty thousand naira, fifty kobo". */
export function koboInWords(kobo: number): string {
  if (!Number.isSafeInteger(kobo) || kobo < 0) throw new RangeError("koboInWords takes a non-negative safe integer");
  const naira = Math.floor(kobo / 100);
  const k = kobo % 100;
  const nairaWords = `${numberInWords(naira)} naira`;
  return k === 0 ? nairaWords : `${nairaWords}, ${numberInWords(k)} kobo`;
}

/** The receipt form: "Fifty thousand naira only", "Fifty thousand naira, fifty kobo only". */
export function receiptAmountInWords(kobo: number): string {
  const words = koboInWords(kobo);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} only`;
}
