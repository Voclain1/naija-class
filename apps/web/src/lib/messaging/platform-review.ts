import type { MessagingRateReviewWrite, MessagingTemplateReviewWrite } from "@school-kit/types";
export type Rate = MessagingRateReviewWrite["rates"][number];
export const RATE_KEYS = ["TERMII_SMS", "META_UTILITY", "META_MARKETING", "META_AUTHENTICATION"] as const;
export const TEMPLATE_NAMES = ["fee_payment_reminder","fee_payment_confirmation","fee_invoice_issued","fee_payment_overdue","guardian_invitation","student_absence_alert","examination_notification","results_released"] as const;
export const BODY_FIELDS = ["schoolName","amountPaid","balanceLeft","studentName","absenceDate","termName","examTitle","examStart","dueDate","parentPortalUrl"] as const;
type Review = NonNullable<MessagingTemplateReviewWrite["review"]>;

export function emptyRate(key: Rate["key"]): Rate {
  return {key, version:"", evidence:"", effectiveFrom:"", effectiveUntil:"", verifiedAt:"", providerAmount:"", rateNumerator:"", rateDenominator:"", taxBasisPoints:"", marginBasisPoints:""};
}
const positive = (value: string) => /^[1-9]\d{0,9}$/.test(value) && BigInt(value) <= 2147483647n;
const basis = (value: string) => /^\d{1,6}$/.test(value);
const instant = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

export function catalogIssue(rates: readonly Rate[], scope: "platform" | "school", now = Date.now()): string | null {
  if (!rates.length || rates.length > 100) return "Add between one and 100 verified rate versions.";
  const seen = new Set<string>();
  for (const r of rates) {
    if (!RATE_KEYS.includes(r.key) || (scope === "platform" && r.key !== "TERMII_SMS")) return "Invalid price key for this scope.";
    if (!r.version.trim() || r.version.length > 100 || !r.evidence.trim() || r.evidence.length > 300) return "Each rate needs its own version and evidence reference.";
    if (!positive(r.providerAmount) || !positive(r.rateNumerator) || !positive(r.rateDenominator) || !basis(r.taxBasisPoints) || !basis(r.marginBasisPoints)) return "Amounts and conversion ratios must be positive integers; tax and margin must be nonnegative basis points.";
    if (![r.effectiveFrom,r.effectiveUntil,r.verifiedAt].every(instant) || Date.parse(r.effectiveFrom) >= Date.parse(r.effectiveUntil) || Date.parse(r.verifiedAt) > now) return "Use valid ISO timestamps with offsets, a positive validity interval and a verification time no later than now.";
    const key = r.key + ":" + r.version;
    if (seen.has(key)) return "Duplicate price version.";
    seen.add(key);
  }
  for (let i = 0; i < rates.length; i++) {
    const a = rates[i];
    if (rates.slice(i+1).some(b => a.key === b.key && Date.parse(a.effectiveFrom) < Date.parse(b.effectiveUntil) && Date.parse(b.effectiveFrom) < Date.parse(a.effectiveUntil))) return "Validity intervals overlap for a price key.";
  }
  return null;
}

// Mirrors the server formula for display only. Never submits a computed rate.
export function unitKobo(rate: Rate): bigint | null {
  if (!positive(rate.providerAmount) || !positive(rate.rateNumerator) || !positive(rate.rateDenominator) || !basis(rate.taxBasisPoints) || !basis(rate.marginBasisPoints)) return null;
  const scale = 10000n;
  const numerator = BigInt(rate.providerAmount)*BigInt(rate.rateNumerator)*(scale+BigInt(rate.taxBasisPoints))*(scale+BigInt(rate.marginBasisPoints));
  const denominator = BigInt(rate.rateDenominator)*scale*scale;
  return (numerator+denominator-1n)/denominator;
}
export function validTemplateReview(review: Review): boolean {
  if (!/^\d{1,32}$/.test(review.wabaId) || !/^\d{1,32}$/.test(review.providerTemplateId) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(review.language) || !review.approvedBody.trim() || review.approvedBody.length > 1024 || !["UTILITY","MARKETING","AUTHENTICATION"].includes(review.category)) return false;
  const variables = [...review.approvedBody.matchAll(/\{\{(\d+)\}\}/g)].map(m=>m[1]);
  return variables.length === review.bodyFields.length && variables.length <= 20 && variables.every((v,i)=>v===String(i+1)) && !/[{}]/.test(review.approvedBody.replace(/\{\{\d+\}\}/g,"")) && review.bodyFields.every(f=>BODY_FIELDS.includes(f)) && (review.paymentButtonIndex === undefined || (Number.isInteger(review.paymentButtonIndex) && review.paymentButtonIndex>=0 && review.paymentButtonIndex<=9));
}
