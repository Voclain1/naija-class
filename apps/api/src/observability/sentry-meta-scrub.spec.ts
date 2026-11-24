import { expect, it } from "vitest";

import { dropsRequestBody } from "./sentry";

it("drops Meta webhook bodies from API error reports", () => {
  expect(dropsRequestBody("https://api.schoolkit.ng/api/v1/webhooks/meta?hub.verify_token=fictional")).toBe(true);
  expect(dropsRequestBody("/api/v1/webhooks/meta")).toBe(true);
  expect(dropsRequestBody("/api/v1/messaging/whatsapp/connection/register")).toBe(true);
  expect(dropsRequestBody("/api/v1/messaging/whatsapp/templates")).toBe(true);
  expect(dropsRequestBody("/api/v1/webhooks/metastats")).toBe(false);
});
