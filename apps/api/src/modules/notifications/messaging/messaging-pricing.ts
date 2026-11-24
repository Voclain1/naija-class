const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXTENDED = new Set("\f^{}\\[~]|€");

export function countSmsSegments(text: string): number {
  if (!text) return 0;
  const characters = Array.from(text);
  const unicode = characters.some((character) => !GSM_BASIC.has(character) && !GSM_EXTENDED.has(character));
  const widths = characters.map((character) => unicode ? character.length : GSM_EXTENDED.has(character) ? 2 : 1);
  if (widths.reduce((sum, width) => sum + width, 0) <= (unicode ? 70 : 160)) return 1;
  const limit = unicode ? 67 : 153;
  let segments = 1;
  let used = 0;
  for (const width of widths) {
    if (used + width > limit) {
      segments++;
      used = 0;
    }
    used += width;
  }
  return segments;
}

export interface MessagingUnitPrice {
  /** Provider price in the smallest quoted unit, e.g. USD cents or NGN kobo. */
  providerAmount: bigint;
  /** Exchange ratio from that quoted unit to NGN kobo. */
  rateNumerator: bigint;
  rateDenominator: bigint;
  taxBasisPoints: bigint;
  marginBasisPoints: bigint;
}

export function quoteMessagingKobo(price: MessagingUnitPrice, units: number): bigint {
  if (!Number.isSafeInteger(units) || units <= 0 ||
      price.providerAmount <= 0n || price.rateNumerator <= 0n || price.rateDenominator <= 0n ||
      price.taxBasisPoints < 0n || price.marginBasisPoints < 0n) {
    throw new RangeError("Invalid messaging price or unit count");
  }
  const scale = 10_000n;
  const numerator = BigInt(units) * price.providerAmount * price.rateNumerator *
    (scale + price.marginBasisPoints) * (scale + price.taxBasisPoints);
  const denominator = price.rateDenominator * scale * scale;
  return (numerator + denominator - 1n) / denominator;
}
