import { describe, expect, it } from "vitest";

import { dropsRequestBody } from "./sentry.js";

// Error reports never carry the body of an Assistant request: chat and voice
// turns, transcripts, speech text, typed names (docs/modules/assistant-ai-governance.md).
describe("Sentry drops Assistant request bodies [release-check:eng.no-content-retention]", () => {
  it("drops the body for every assistant route", () => {
    for (const url of [
      "https://api.schoolkit.ng/api/v1/assistant/workspace/turn",
      "/api/v1/assistant/workspace/students/find",
      "/api/v1/assistant/workspace/help",
      "/api/v1/assistant/voice/sessions/6f9d1a52-6a8e-4d39-9d0c-5b7a3b0b0001/turns",
      "/api/v1/assistant/voice/sessions/6f9d1a52-6a8e-4d39-9d0c-5b7a3b0b0001/speech",
      "/api/v1/assistant/billing/runs",
    ]) expect(dropsRequestBody(url), url).toBe(true);
  });
  it("keeps the existing pattern redaction for other routes", () => {
    for (const url of ["/api/v1/students", "/api/v1/finance/payments", undefined]) expect(dropsRequestBody(url)).toBe(false);
  });
});
