import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the Sentry re-export at the path the service imports it from, hoisted
// so the mock exists before the service module binds to it.
const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("../../observability/sentry", () => ({ Sentry: { captureMessage } }));

import { EmailService } from "./email.service";

function serviceWith(send: (...args: unknown[]) => unknown): EmailService {
  const svc = new EmailService({ get: () => "re_test_key" } as never);
  (svc as unknown as { client: { emails: { send: typeof send } } }).client = { emails: { send } };
  return svc;
}

const MESSAGE = {
  to: "ada.parent@example.test",
  subject: "Reset your Adaeze's school password",
  html: "<p>x</p>",
  purpose: "guardian-password-reset",
};

describe("EmailService.send — failures reach Sentry (2026-10-08)", () => {
  beforeEach(() => captureMessage.mockReset());

  it("an API-level error is reported with its purpose, a redacted address and no subject", async () => {
    const svc = serviceWith(async () => ({ data: null, error: { message: "domain suspended" } }));
    await expect(svc.send(MESSAGE)).rejects.toThrow("Email send failed: domain suspended");

    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [, context] = captureMessage.mock.calls[0]!;
    expect(context.tags).toEqual({ component: "email", purpose: "guardian-password-reset" });
    expect(context.extra.reason).toBe("domain suspended");
    const sent = JSON.stringify(captureMessage.mock.calls[0]);
    expect(sent).not.toContain("ada.parent@example.test");
    expect(sent).not.toContain("Adaeze");
  });

  it("a network-level throw is reported too", async () => {
    const svc = serviceWith(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(svc.send(MESSAGE)).rejects.toThrow("Email send failed: ECONNRESET");
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it("a successful send reports nothing", async () => {
    const svc = serviceWith(async () => ({ data: { id: "e1" }, error: null }));
    await expect(svc.send(MESSAGE)).resolves.toBeUndefined();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
