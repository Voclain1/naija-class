import type { Kobo } from "@school-kit/types";
export function parseTopUpNaira(value: string): Kobo | null {
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match?.[1]) return null;
  const kobo = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return kobo > 0n && kobo <= 9999999999n ? (String(kobo) as Kobo) : null;
}
export function safeCheckoutUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin === "https://checkout.paystack.com" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
