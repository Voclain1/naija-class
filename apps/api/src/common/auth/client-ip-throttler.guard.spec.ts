import { Controller, Get, INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Throttle, ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClientIpThrottlerGuard, clientIp } from "./client-ip-throttler.guard";
import { signClientIp, verifiedForwardedIp } from "./forwarded-client-ip";

// Per-client throttling behind Fly's proxy (client-ip-throttler.guard.ts).

@Controller("probe")
class ProbeController {
  @Get()
  @Throttle({ default: { ttl: 60000, limit: 2 } })
  probe() {
    return { ok: true };
  }
}

describe("clientIp", () => {
  it("prefers the address Fly's proxy reports, and falls back to the socket where there is none", () => {
    expect(clientIp({ headers: { "fly-client-ip": " 102.89.1.7 " }, ip: "fdaa::1" })).toBe("102.89.1.7");
    expect(clientIp({ headers: { "fly-client-ip": ["102.89.1.8"] }, ip: "fdaa::1" })).toBe("102.89.1.8");
    expect(clientIp({ headers: {}, ip: "127.0.0.1" })).toBe("127.0.0.1");
    expect(clientIp({ headers: { "fly-client-ip": "" }, socket: { remoteAddress: "::1" } })).toBe("::1");
  });
});

describe("ClientIpThrottlerGuard over HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: "default", ttl: 60000, limit: 200 }] })],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: ClientIpThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const from = (ip: string) => request(app.getHttpServer()).get("/probe").set("Fly-Client-IP", ip);

  it("two families behind the same proxy each get their own limit", async () => {
    // Every request arrives from the same socket (the test client) — exactly
    // what Fly's proxy looks like to the app. Only Fly-Client-IP differs.
    await from("102.89.0.1").expect(200);
    await from("102.89.0.1").expect(200);
    await from("102.89.0.1").expect(429);

    // A different family is unaffected by the first one's spent limit.
    await from("102.89.0.2").expect(200);
    await from("102.89.0.2").expect(200);
  });
});

// ---------------------------------------------------------------------------
// The portal's forwarded address (forwarded-client-ip.ts, 2026-10-05)
// ---------------------------------------------------------------------------
const SECRET = "0123456789abcdef0123456789abcdef";
const NOW = 1_790_000_000;
const signed = (ip: string, ts = NOW, secret = SECRET) => ({
  "x-sk-client-ip": ip,
  "x-sk-client-ip-ts": String(ts),
  "x-sk-client-ip-sig": signClientIp(secret, ip, ts),
});

describe("verifiedForwardedIp", () => {
  it("matches the vector the portal's own spec pins — the two servers must agree", () => {
    expect(signClientIp(SECRET, "102.89.4.20", NOW)).toBe(
      "6282c451db4ca0ef333188d0633a17f3ab1f94ab97d61eb7b636b9894be88c13",
    );
  });

  it("trusts a fresh, correctly signed address", () => {
    expect(verifiedForwardedIp(signed("102.89.4.20"), SECRET, NOW + 10)).toBe("102.89.4.20");
  });

  it("ignores everything else: no secret, short secret, unsigned, wrong key, tampered, stale, from the future", () => {
    const h = signed("102.89.4.20");
    expect(verifiedForwardedIp(h, undefined, NOW)).toBeNull();
    expect(verifiedForwardedIp(h, "too-short", NOW)).toBeNull();
    expect(verifiedForwardedIp({ "x-sk-client-ip": "102.89.4.20" }, SECRET, NOW)).toBeNull();
    expect(verifiedForwardedIp(signed("102.89.4.20", NOW, "f".repeat(32)), SECRET, NOW)).toBeNull();
    expect(verifiedForwardedIp({ ...h, "x-sk-client-ip": "102.89.4.21" }, SECRET, NOW)).toBeNull();
    expect(verifiedForwardedIp(h, SECRET, NOW + 301)).toBeNull();
    expect(verifiedForwardedIp(h, SECRET, NOW - 301)).toBeNull();
    expect(verifiedForwardedIp({ ...h, "x-sk-client-ip-sig": "not-hex" }, SECRET, NOW)).toBeNull();
  });

  it("clientIp prefers a verified forwarded address, and falls back to Fly-Client-IP otherwise", () => {
    const viaPortal = { headers: { "fly-client-ip": "76.76.21.21", ...signed("102.89.4.20") } };
    expect(clientIp(viaPortal, { secret: SECRET, nowSeconds: NOW })).toBe("102.89.4.20");
    expect(clientIp(viaPortal, { secret: undefined, nowSeconds: NOW })).toBe("76.76.21.21");
    const forged = { headers: { "fly-client-ip": "76.76.21.21", "x-sk-client-ip": "1.2.3.4" } };
    expect(clientIp(forged, { secret: SECRET, nowSeconds: NOW })).toBe("76.76.21.21");
  });
});

describe("ClientIpThrottlerGuard over HTTP — families behind the portal's server", () => {
  let app: INestApplication;
  const previous = process.env.PORTAL_PROXY_SECRET;

  beforeAll(async () => {
    process.env.PORTAL_PROXY_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: "default", ttl: 60000, limit: 200 }] })],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: ClientIpThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previous === undefined) delete process.env.PORTAL_PROXY_SECRET;
    else process.env.PORTAL_PROXY_SECRET = previous;
  });

  // Every request arrives from Vercel (one Fly-Client-IP), as portal traffic does.
  const viaPortal = (headers: Record<string, string>) => {
    const r = request(app.getHttpServer()).get("/probe").set("Fly-Client-IP", "76.76.21.99");
    for (const [k, v] of Object.entries(headers)) r.set(k, v);
    return r;
  };
  const now = () => Math.floor(Date.now() / 1000);

  it("two families signed in through the portal each get their own limit", async () => {
    const family = (ip: string) => viaPortal(signed(ip, now()));
    await family("102.89.9.1").expect(200);
    await family("102.89.9.1").expect(200);
    await family("102.89.9.1").expect(429);
    await family("102.89.9.2").expect(200);
    await family("102.89.9.2").expect(200);
  });

  it("an unsigned forwarded address buys nothing: it is keyed on the proxy, as before", async () => {
    await viaPortal({ "x-sk-client-ip": "9.9.9.1" }).expect(200);
    await viaPortal({ "x-sk-client-ip": "9.9.9.2" }).expect(200);
    await viaPortal({ "x-sk-client-ip": "9.9.9.3" }).expect(429);
  });
});
