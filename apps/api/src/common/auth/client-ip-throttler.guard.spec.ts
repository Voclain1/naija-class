import { Controller, Get, INestApplication } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Throttle, ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClientIpThrottlerGuard, clientIp } from "./client-ip-throttler.guard";

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
