import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { staffMobileChallenge, staffMobileLogin } from "./staff-auth";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ requiresTwoFactor: true, challengeToken: "challenge" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("staff auth request encoding", () => {
  it("sends mobile login credentials as one JSON object, not a JSON string", async () => {
    await staffMobileLogin({
      email: "owner@example.test",
      password: "correct horse battery staple",
      deviceId: "device-install-id-1234",
      deviceName: "Arinzechukwu's phone",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(
      JSON.stringify({
        email: "owner@example.test",
        password: "correct horse battery staple",
        deviceId: "device-install-id-1234",
        deviceName: "Arinzechukwu's phone",
      }),
    );
    expect(JSON.parse(init.body as string)).toMatchObject({ email: "owner@example.test" });
    expect(typeof JSON.parse(init.body as string)).toBe("object");
  });

  it("sends the 2FA challenge as one JSON object, not a JSON string", async () => {
    await staffMobileChallenge({
      challengeToken: "challenge-token",
      code: "123456",
      deviceId: "device-install-id-1234",
      deviceName: "Arinzechukwu's phone",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      challengeToken: "challenge-token",
      code: "123456",
      deviceId: "device-install-id-1234",
      deviceName: "Arinzechukwu's phone",
    });
  });
});
