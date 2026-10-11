import { afterEach, describe, expect, it, vi } from "vitest";

const { ctor, capture } = vi.hoisted(() => ({ ctor: vi.fn(), capture: vi.fn() }));
vi.mock("posthog-node", () => ({
  PostHog: class {
    constructor(...args: unknown[]) {
      ctor(...args);
    }
    capture = capture;
    shutdown = vi.fn();
  },
}));

import { captureServerEvent, resetPostHogForTests } from "./posthog";

const EVENT = {
  event: "validation_rejected" as const,
  distinctId: "u-1",
  properties: { route: "POST /api/v1/x", issue_paths: ["a"] },
};

describe("server-side PostHog", () => {
  afterEach(() => {
    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_HOST;
    resetPostHogForTests();
    ctor.mockReset();
    capture.mockReset();
  });

  it("does nothing, and builds no client, without POSTHOG_API_KEY", () => {
    captureServerEvent(EVENT);
    expect(ctor).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("captures with the key, on the default host unless one is set", () => {
    process.env.POSTHOG_API_KEY = "phc_test";
    captureServerEvent(EVENT);
    captureServerEvent(EVENT);
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(ctor.mock.calls[0][0]).toBe("phc_test");
    expect(ctor.mock.calls[0][1]).toMatchObject({ host: "https://us.i.posthog.com" });
    expect(capture).toHaveBeenCalledWith({ distinctId: "u-1", event: "validation_rejected", properties: EVENT.properties });
  });
});
