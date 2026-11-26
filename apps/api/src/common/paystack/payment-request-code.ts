export const PAYSTACK_PAYMENT_REQUEST_BASE = "https://paystack.com/pay/";

export function isPaystackPaymentRequestCode(value: unknown): value is string {
  return typeof value === "string" && /^PRQ_[A-Za-z0-9_]{1,100}$/.test(value);
}
