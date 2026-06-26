import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { Global, Module, INestApplication } from "@nestjs/common";
import request from "supertest";

import { basePrisma } from "@school-kit/db";

import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import { AuthModule } from "../auth/auth.module";
import { SchoolsModule } from "./schools.module";
import { HttpExceptionFilter } from "../../common/http-exception.filter";

const mockRedis = { incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) };
@Global()
@Module({
  providers: [{ provide: REDIS_AUTH_CLIENT, useValue: mockRedis }],
  exports: [REDIS_AUTH_CLIENT],
})
class MockRedisAuthModule {}

// HTTP smoke spec for SchoolsController. Proves wiring (AuthGuard, pipes,
// HttpExceptionFilter), response envelopes, and the error-code surface.
// Service-level invariants (audit log content, RLS scoping, role lookups
// under FORCE RLS) live in schools.service.spec.ts.

describe("SchoolsController (Slice 6)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const phoneSuffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  const schoolIdsToCleanup = new Set<string>();
  let app: INestApplication;

  // A signed-up owner whose bearer token gets used by most cases.
  const ownerEmail = `sc-${runId}@example.test`;
  const ownerPassword = "Correct-Horse-9";
  let ownerToken: string;
  let ownerSchoolId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MockRedisAuthModule, AuthModule, SchoolsModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const signupRes = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send({
        schoolName: "Controller Spec Academy",
        schoolSlug: `sc-${runId}`,
        ownerFirstName: "Ctrl",
        ownerLastName: "Tester",
        ownerEmail,
        ownerPhone: `+23483${phoneSuffix}`,
        password: ownerPassword,
        ndprConsent: true,
      });
    expect(signupRes.status).toBe(201);
    ownerToken = signupRes.body.token;
    ownerSchoolId = signupRes.body.school.id;
    schoolIdsToCleanup.add(ownerSchoolId);
  });

  afterAll(async () => {
    await app.close();
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  function withAuth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  // ---------------------------------------------------------------------
  // Auth guard surface
  // ---------------------------------------------------------------------

  it("GET /schools/me without a bearer token — 401 MISSING_BEARER_TOKEN", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/schools/me");
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("MISSING_BEARER_TOKEN");
  });

  it("GET /schools/me with garbage token — 401 INVALID_SESSION", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/schools/me")
      .set(withAuth("not-a-real-token"));
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("INVALID_SESSION");
  });

  // ---------------------------------------------------------------------
  // GET /schools/me
  // ---------------------------------------------------------------------

  it("GET /schools/me — returns the SchoolMeDto with all wider fields present", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/schools/me")
      .set(withAuth(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ownerSchoolId);
    expect(res.body.status).toBe("ONBOARDING");
    expect(res.body.onboardingStep).toBe(0);
    // Wider fields exposed on this endpoint (even when null).
    expect(res.body).toHaveProperty("motto");
    expect(res.body).toHaveProperty("logoUrl");
    expect(res.body).toHaveProperty("address");
    expect(res.body).toHaveProperty("primaryColor");
    expect(res.body).toHaveProperty("ndprConsentAt");
  });

  // ---------------------------------------------------------------------
  // PATCH /schools/me
  // ---------------------------------------------------------------------

  it("PATCH /schools/me with {} — 400 VALIDATION_ERROR (refine 'at least one field required')", async () => {
    const res = await request(app.getHttpServer())
      .patch("/api/v1/schools/me")
      .set(withAuth(ownerToken))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    const detailString = JSON.stringify(res.body.error?.details);
    expect(detailString).toContain("at least one field is required");
  });

  it("PATCH /schools/me with unknown key — 400 VALIDATION_ERROR (strict)", async () => {
    const res = await request(app.getHttpServer())
      .patch("/api/v1/schools/me")
      .set(withAuth(ownerToken))
      .send({ primary_color: "#112233" }); // snake_case typo
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH /schools/me with a real change — 200 and returns updated school", async () => {
    const res = await request(app.getHttpServer())
      .patch("/api/v1/schools/me")
      .set(withAuth(ownerToken))
      .send({ motto: "Patched motto." });
    expect(res.status).toBe(200);
    expect(res.body.motto).toBe("Patched motto.");
  });

  // ---------------------------------------------------------------------
  // POST /schools/me/onboarding/:step
  // ---------------------------------------------------------------------

  it("POST /schools/me/onboarding/3 when on step 0 — 409 INVALID_ONBOARDING_STEP", async () => {
    // Owner is on onboardingStep=0 (fresh signup, just patched motto in the
    // previous test — patch doesn't move the step counter).
    const res = await request(app.getHttpServer())
      .post("/api/v1/schools/me/onboarding/3")
      .set(withAuth(ownerToken))
      .send({ invites: [] });
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe("INVALID_ONBOARDING_STEP");
  });

  it("POST /schools/me/onboarding/1 — happy path advances to step 1 and returns wrapped school", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/schools/me/onboarding/1")
      .set(withAuth(ownerToken))
      .send({
        name: "Slice 6 Wired Academy",
        phone: "+2348099999999",
        email: `wired-${runId}@example.test`,
      });
    expect(res.status).toBe(200);
    expect(res.body.school?.onboardingStep).toBe(1);
    expect(res.body.school?.name).toBe("Slice 6 Wired Academy");
  });

  it("POST /schools/me/onboarding/2 with {} — 200, step advances (branding optional)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/schools/me/onboarding/2")
      .set(withAuth(ownerToken))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.school?.onboardingStep).toBe(2);
    expect(res.body.school?.logoUrl).toBeNull();
    expect(res.body.school?.primaryColor).toBeNull();
  });

  it("POST /schools/me/onboarding/3 with duplicate emails — 400 VALIDATION_ERROR", async () => {
    const dup = `dup-${runId}@example.test`;
    const res = await request(app.getHttpServer())
      .post("/api/v1/schools/me/onboarding/3")
      .set(withAuth(ownerToken))
      .send({ invites: [{ email: dup }, { email: dup }] });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body.error?.details)).toContain("duplicate email");
  });

  it("POST /schools/me/onboarding/4 with ndprConsent=false — 400 VALIDATION_ERROR", async () => {
    // Walk past step 3 first.
    await request(app.getHttpServer())
      .post("/api/v1/schools/me/onboarding/3")
      .set(withAuth(ownerToken))
      .send({ invites: [] });

    const res = await request(app.getHttpServer())
      .post("/api/v1/schools/me/onboarding/4")
      .set(withAuth(ownerToken))
      .send({ ndprConsent: false });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body.error?.details)).toContain("ndprConsent");
  });

  it("POST /schools/me/onboarding/5 — flips status to ACTIVE", async () => {
    // Complete step 4 first.
    await request(app.getHttpServer())
      .post("/api/v1/schools/me/onboarding/4")
      .set(withAuth(ownerToken))
      .send({ ndprConsent: true });

    const res = await request(app.getHttpServer())
      .post("/api/v1/schools/me/onboarding/5")
      .set(withAuth(ownerToken))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.school?.status).toBe("ACTIVE");
    expect(res.body.school?.onboardingStep).toBe(5);
  });
});
