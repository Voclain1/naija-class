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
  providerTemplateId: string;
  approvedBody: string;
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
  billing: "SCHOOL_OWNED";
}

export type MetaSendOutcome =
  | { status: "ACCEPTED"; providerRef: string }
  | { status: "BLOCKED"; reason: "CONFIGURATION" | "TEMPLATE" | "CATEGORY_REVIEW_REQUIRED" | "RECIPIENT" | "PARAMETERS" }
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
  beforeSubmit?: () => Promise<boolean>,
): Promise<MetaSendOutcome> {
  if (!account?.token || account.billing !== "SCHOOL_OWNED" || !/^\d+$/.test(account.wabaId) || !/^v\d+\.\d+$/.test(account.graphVersion) || !/^\d+$/.test(account.phoneNumberId)) {
    return { status: "BLOCKED", reason: "CONFIGURATION" };
  }
  if (!template || !/^\d+$/.test(template.providerTemplateId) || !template.approvedBody || template.approval !== "APPROVED" || template.wabaId !== account.wabaId ||
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
  const review = await currentMetaReview(account, template, fetchImpl);
  if (review !== "CURRENT") return { status: "BLOCKED", reason: review };

  const components: unknown[] = [];
  if (values.length) components.push({ type: "body", parameters: values.map((text) => ({ type: "text", text })) });
  if (index !== undefined) {
    components.push({ type: "button", sub_type: "url", index: String(index), parameters: [{ type: "text", text: paymentCode }] });
  }
  if (beforeSubmit && !(await beforeSubmit())) return { status: "BLOCKED", reason: "RECIPIENT" };
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

async function currentMetaReview(
  account: MetaAccount,
  template: VerifiedMetaTemplate,
  fetchImpl: typeof fetch,
): Promise<"CURRENT" | "TEMPLATE" | "CATEGORY_REVIEW_REQUIRED"> {
  const url = new URL(`https://graph.facebook.com/${account.graphVersion}/${account.wabaId}/message_templates`);
  url.searchParams.set("name", template.name);
  url.searchParams.set("fields", "id,name,language,status,category,components");
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${account.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return "TEMPLATE";
    const { data } = await response.json() as { data?: {
      id: string; name: string; language: string; status: string; category: string;
      components?: { type: string; text?: string; format?: string; buttons?: { type: string; url?: string }[] }[];
    }[] };
    const live = data?.find((item) => item.id === template.providerTemplateId &&
      item.name === template.name && item.language === template.language);
    if (!live || live.status !== "APPROVED") return "TEMPLATE";
    if (live.category !== template.category) return "CATEGORY_REVIEW_REQUIRED";
    const components = live.components ?? [];
    if (components.some(({ type, format }) => !["BODY", "FOOTER", "BUTTONS", "HEADER"].includes(type) ||
        (type === "HEADER" && format !== "TEXT"))) return "TEMPLATE";
    const body = components.find((part) => part.type === "BODY")?.text;
    if (body !== template.approvedBody ||
        components.some(({ type, text }) => type === "HEADER" && text?.includes("{{"))) return "TEMPLATE";
    const slots = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(([, n]) => Number(n));
    if (slots.length !== template.bodyFields.length || slots.some((slot, index) => slot !== index + 1)) return "TEMPLATE";
    const buttons = components.find((part) => part.type === "BUTTONS")?.buttons ?? [];
    const dynamic = buttons.flatMap((button, index) => button.url?.includes("{{") ? [index] : []);
    if (template.paymentButtonIndex === undefined) return dynamic.length === 0 ? "CURRENT" : "TEMPLATE";
    const button = buttons[template.paymentButtonIndex];
    return dynamic.length === 1 && dynamic[0] === template.paymentButtonIndex && button?.type === "URL" &&
      button.url === "https://paystack.com/pay/{{1}}" ? "CURRENT" : "TEMPLATE";
  } catch {
    return "TEMPLATE";
  }
}
