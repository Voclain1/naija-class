import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { sendMetaTemplate, validMetaSignature, type VerifiedMetaTemplate } from "./meta-provider";

const account = { token: "fictional", wabaId: "12", phoneNumberId: "34", graphVersion: "v27.0" };
const template: VerifiedMetaTemplate = {
  name: "fee_payment_reminder", wabaId: account.wabaId, language: "en_US", category: "UTILITY",
  approval: "APPROVED", bodyFields: ["school", "amount"], paymentButtonIndex: 0,
};
const recipient = "+15550100123";
const fields = { amount: "NGN 25", school: "Fictional School" };

describe("Meta template transport", () => {
  it("uses verified body order and keeps the dynamic button to a bare payment code", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ messages: [{ id: "wamid.fictional" }] }));
    expect(await sendMetaTemplate(account, template, recipient, fields, "PRQ_fictional", fetcher))
      .toEqual({ status: "ACCEPTED", providerRef: "wamid.fictional" });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).template).toEqual({
      name: template.name, language: { code: "en_US" }, components: [
        { type: "body", parameters: [{ type: "text", text: "Fictional School" }, { type: "text", text: "NGN 25" }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "PRQ_fictional" }] },
      ],
    });
  });

  it("blocks disabled configuration, pending approvals, wrong accounts, invalid numbers and full URLs", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const code = "PRQ_fictional";
    expect((await sendMetaTemplate(undefined, template, recipient, fields, code, fetcher)).status).toBe("BLOCKED");
    expect((await sendMetaTemplate(account, { ...template, approval: "PENDING" }, recipient, fields, code, fetcher)).status).toBe("BLOCKED");
    expect((await sendMetaTemplate(account, { ...template, wabaId: "99" }, recipient, fields, code, fetcher)).status).toBe("BLOCKED");
    expect((await sendMetaTemplate(account, template, "555", fields, code, fetcher)).status).toBe("BLOCKED");
    expect((await sendMetaTemplate(account, template, recipient, fields, "https://paystack.com/pay/PRQ_fictional", fetcher)).status).toBe("BLOCKED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never retries uncertain provider outcomes", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("fictional timeout"));
    expect(await sendMetaTemplate(account, template, recipient, fields, "PRQ_fictional", fetcher)).toEqual({ status: "UNKNOWN" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it("authenticates exact bytes and fails closed on forged or malformed Meta signatures", () => {
  const body = Buffer.from('{"entry": []}');
  const secret = "fictional-app-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  expect(validMetaSignature(body, signature, secret)).toBe(true);
  expect(validMetaSignature(Buffer.from('{"entry":[]}'), signature, secret)).toBe(false);
  expect(validMetaSignature(body, signature, undefined)).toBe(false);
  expect(validMetaSignature(body, "sha256=broken", secret)).toBe(false);
});
