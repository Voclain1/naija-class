export function isPaystackPaymentRequestCode(value: unknown): value is string {
  return typeof value === "string" && /^PRQ_[A-Za-z0-9_]{1,100}$/.test(value);
}
