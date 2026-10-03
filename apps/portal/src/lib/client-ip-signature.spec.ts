import { describe, expect, it } from "vitest";

import { clientIpHeaders, requestClientIp, signClientIp } from "./client-ip-signature";

// The portal half of the signed forwarded address. The API half
// (apps/api/src/common/auth/client-ip-throttler.guard.spec.ts) pins the same
// vector: if either side changes the message format, one of the two fails.

const SECRET = "0123456789abcdef0123456789abcdef";
const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;

describe("client IP signature", () => {
  it("matches the vector the API's spec pins", () => {
    expect(signClientIp(SECRET, "102.89.4.20", 1_790_000_000)).toBe(
      "6282c451db4ca0ef333188d0633a17f3ab1f94ab97d61eb7b636b9894be88c13",
    );
  });

  it("reads the address Vercel reports: x-real-ip, else the first x-forwarded-for entry", () => {
    expect(requestClientIp(headers({ "x-real-ip": "102.89.4.20", "x-forwarded-for": "9.9.9.9" }))).toBe("102.89.4.20");
    expect(requestClientIp(headers({ "x-forwarded-for": "102.89.4.21, 76.76.21.21" }))).toBe("102.89.4.21");
    expect(requestClientIp(headers({}))).toBeNull();
  });

  it("signs the address with a timestamp", () => {
    expect(clientIpHeaders(headers({ "x-real-ip": "102.89.4.20" }), SECRET, 1_790_000_000)).toEqual({
      "x-sk-client-ip": "102.89.4.20",
      "x-sk-client-ip-ts": "1790000000",
      "x-sk-client-ip-sig": "6282c451db4ca0ef333188d0633a17f3ab1f94ab97d61eb7b636b9894be88c13",
    });
  });

  it("sends nothing without a usable secret or an address, so the API behaves as before", () => {
    expect(clientIpHeaders(headers({ "x-real-ip": "102.89.4.20" }), undefined)).toEqual({});
    expect(clientIpHeaders(headers({ "x-real-ip": "102.89.4.20" }), "short")).toEqual({});
    expect(clientIpHeaders(headers({}), SECRET)).toEqual({});
  });
});
