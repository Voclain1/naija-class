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

export type MessagingPriceKey = "TERMII_SMS" | "META_UTILITY" | "META_MARKETING" | "META_AUTHENTICATION";
export type MessagingBilling = "SCHOOL_OWNED" | "SCHOOLKIT";

export interface VerifiedMessagingRate extends MessagingUnitPrice {
  key: MessagingPriceKey;
  version: string;
  effectiveFrom: Date;
  effectiveUntil: Date;
  verifiedAt: Date;
  evidence: string;
}

export function resolveMessagingRate(
  rates: readonly VerifiedMessagingRate[],
  key: MessagingPriceKey,
  at: Date,
): VerifiedMessagingRate | undefined {
  const instant = at.getTime();
  const effective = rates.filter((rate) => rate.key === key && rate.effectiveFrom.getTime() <= instant &&
    instant < rate.effectiveUntil.getTime());
  // Overlapping effective intervals are configuration errors. A future or
  // unverified replacement must never fall back to an older price.
  if (effective.length !== 1) return undefined;
  const rate = effective[0]!;
  if (!rate.version.trim() || !rate.evidence.trim() || !(rate.verifiedAt.getTime() <= instant)) return undefined;
  try {
    quoteMessagingKobo(rate, 1);
    return rate;
  } catch {
    return undefined;
  }
}

export function quoteDispatchCost(
  rates: readonly VerifiedMessagingRate[],
  key: MessagingPriceKey,
  billing: MessagingBilling,
  units: number,
  at: Date,
): { rateVersion: string; estimatedKobo: bigint; walletKobo: bigint } | undefined {
  if (billing === "SCHOOL_OWNED" && key === "TERMII_SMS") return undefined;
  // The tenant path only supports school-owned Meta billing. The legacy
  // internal alert uses a separate transport and never consults this catalog.
  if (billing === "SCHOOLKIT" && key !== "TERMII_SMS") return undefined;
  const rate = resolveMessagingRate(rates, key, at);
  if (!rate) return undefined;
  const estimatedKobo = quoteMessagingKobo(rate, units);
  return { rateVersion: rate.version, estimatedKobo, walletKobo: billing === "SCHOOL_OWNED" ? 0n : estimatedKobo };
}
