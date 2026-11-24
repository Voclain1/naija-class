import { createHmac, timingSafeEqual } from "node:crypto";

import { isPaystackPaymentRequestCode } from "../../../common/paystack/payment-request-code";

export const META_TEMPLATE_NAMES = [
  "fee_payment_reminder", "fee_payment_confirmation", "fee_invoice_issued",
  "fee_payment_overdue", "guardian_invitation", "student_absence_alert",
  "examination_notification", "results_released", "setup_call_booked",
] as const;

export interface VerifiedMetaTemplate {
  name: (typeof META_TEMPLATE_NAMES)[number];
  wabaId: string;
  language: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  approval: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED";
  bodyFields: readonly string[];
  paymentButtonIndex?: number;
}

export interface MetaAccount {
  wabaId: string;
  phoneNumberId: string;
  token: string;
  graphVersion: string;
}

export type MetaSendOutcome =
  | { status: "ACCEPTED"; providerRef: string }
  | { status: "BLOCKED"; reason: "CONFIGURATION" | "TEMPLATE" | "RECIPIENT" | "PARAMETERS" }
  | { status: "UNKNOWN"; httpStatus?: number };

export function validMetaSignature(body: Buffer | undefined, signature: unknown, secret: string | undefined): boolean {
  if (!body || !secret || typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

/** Caller supplies independently verified template metadata for the account. */
export async function sendMetaTemplate(
  account: MetaAccount | undefined,
  template: VerifiedMetaTemplate | undefined,
  recipient: string,
  fields: Readonly<Record<string, string>>,
  paymentCode?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaSendOutcome> {
  if (!account?.token || !/^v\d+\.\d+$/.test(account.graphVersion) || !/^\d+$/.test(account.phoneNumberId)) {
    return { status: "BLOCKED", reason: "CONFIGURATION" };
  }
  if (!template || template.approval !== "APPROVED" || template.wabaId !== account.wabaId ||
      !META_TEMPLATE_NAMES.includes(template.name) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language)) {
    return { status: "BLOCKED", reason: "TEMPLATE" };
  }
  if (!/^\+[1-9]\d{7,14}$/.test(recipient)) return { status: "BLOCKED", reason: "RECIPIENT" };
  const values = template.bodyFields.map((field) => Object.hasOwn(fields, field) ? fields[field]?.replace(/\s+/g, " ").trim() : undefined);
  const expectsPayment = ["fee_payment_reminder", "fee_invoice_issued", "fee_payment_overdue"].includes(template.name);
  const index = template.paymentButtonIndex;
  if (values.some((value) => !value) ||
      (expectsPayment && (index === undefined || !Number.isInteger(index) || index < 0 || !isPaystackPaymentRequestCode(paymentCode))) ||
      (!expectsPayment && (index !== undefined || paymentCode !== undefined))) {
    return { status: "BLOCKED", reason: "PARAMETERS" };
  }
  const components: unknown[] = [];
  if (values.length) components.push({ type: "body", parameters: values.map((text) => ({ type: "text", text })) });
  if (index !== undefined) {
    components.push({ type: "button", sub_type: "url", index: String(index), parameters: [{ type: "text", text: paymentCode }] });
  }
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${account.graphVersion}/${account.phoneNumberId}/messages`, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient.slice(1),
        type: "template",
        template: { name: template.name, language: { code: template.language }, components },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { status: "UNKNOWN", httpStatus: response.status };
    const data = (await response.json()) as { messages?: { id?: unknown }[] };
    const id = data.messages?.[0]?.id;
    return typeof id === "string" && id.length > 0 && id.length <= 512
      ? { status: "ACCEPTED", providerRef: id }
      : { status: "UNKNOWN", httpStatus: response.status };
  } catch {
    return { status: "UNKNOWN" };
  }
}
