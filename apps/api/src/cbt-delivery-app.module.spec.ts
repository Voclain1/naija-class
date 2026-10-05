import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "./app.module";
import { CbtDeliveryAppModule } from "./cbt-delivery-app.module";
import { rootModuleFor } from "./root-module";

// The exam-day service (CBT4, docs/modules/cbt.md D9): API_MODE=cbt-delivery
// boots ONLY the public delivery routes and the health check. Proven over
// HTTP: the delivery route answers with the API's error shape, and a staff
// route that exists on the full API is simply not there.

describe("CbtDeliveryAppModule (API_MODE=cbt-delivery)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [CbtDeliveryAppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix("api/v1");
    await app.init();
  });
  afterAll(async () => app?.close());

  it("is chosen only by API_MODE=cbt-delivery", () => {
    expect(rootModuleFor("cbt-delivery")).toBe(CbtDeliveryAppModule);
    expect(rootModuleFor(undefined)).toBe(AppModule);
    expect(rootModuleFor("anything-else")).toBe(AppModule);
  });

  it("serves the delivery routes and the health check, and nothing else", async () => {
    const http = request(app.getHttpServer());
    const pack = await http.get("/api/v1/cbt-delivery/no-such-school/packs/ABCDEF").expect(404);
    expect(pack.body.error.message).toMatch(/No exam matches that code/);
    await http.get("/api/v1/health").expect(200);
    // On the full API these exist (behind auth); here they are not routes at all.
    await http.get("/api/v1/cbt/sittings").expect(404);
    await http.post("/api/v1/auth/login").send({}).expect(404);
  });
});
