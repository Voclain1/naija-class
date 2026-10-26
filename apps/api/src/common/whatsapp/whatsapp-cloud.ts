import { Logger } from "@nestjs/common";
import { Sentry } from "../../observability/sentry";

// SchoolKit's own WhatsApp alerts, sent through Meta's WhatsApp Cloud API
// (2026-10-26, docs/modules/onboarding-call.md). Only for messages to the
// SchoolKit team, never to a school or a family.
//
// Off until all four settings exist on the API (docs/runbooks/whatsapp-alerts.md):
//   WHATSAPP_CLOUD_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ALERT_TO and the
//   template's name for the message being sent.
// Unset, nothing is sent and nothing fails, like Sentry's DSN. A message to a
// number that has not written to us first must be an approved template, so
// every send is one; its parameters fill the template's {{1}}, {{2}}, ….

const GRAPH_VERSION_DEFAULT = "v21.0";
const TIMEOUT_MS = 10_000;

type Fetch = typeof fetch;

export interface WhatsappTemplateSend {
  template: string | undefined;
  parameters: string[];
  /** Names the message for operators; never the parameters, which carry a phone number. */
  purpose: string;
}

export async function sendWhatsappAlert(
  env: Record<string, string | undefined>,
  send: WhatsappTemplateSend,
  fetchImpl: Fetch = fetch,
): Promise<"sent" | "off" | "failed"> {
  const token = env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  const to = env.WHATSAPP_ALERT_TO?.replace(/\D/g, "");
  if (!token || !phoneNumberId || !to || !send.template) return "off";

  const version = env.WHATSAPP_GRAPH_VERSION || GRAPH_VERSION_DEFAULT;
  const language = env.WHATSAPP_TEMPLATE_LANGUAGE || "en";
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${version}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: send.template,
          language: { code: language },
          components: [
            {
              type: "body",
              // WhatsApp refuses a parameter with a newline or a tab, or more
              // than four spaces in a row.
              parameters: send.parameters.map((text) => ({ type: "text", text: text.replace(/\s+/g, " ").trim() || "-" })),
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`WhatsApp answered ${res.status}`);
    return "sent";
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    new Logger("WhatsappAlert").warn(`WhatsApp alert "${send.purpose}" failed: ${reason}`);
    Sentry.captureMessage("WhatsApp alert failed", { level: "warning", tags: { component: "whatsapp", purpose: send.purpose }, extra: { reason } });
    return "failed";
  }
}
