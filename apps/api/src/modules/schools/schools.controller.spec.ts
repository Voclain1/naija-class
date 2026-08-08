import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { Global, Module, INestApplication } from "@nestjs/common";
import request from "supertest";

import { basePrisma } from "@school-kit/db";

import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import { StorageModule } from "../../common/storage/storage.module";
import { AuthModule } from "../auth/auth.module";
import { SchoolsModule } from "./schools.module";
import { HttpExceptionFilter } from "../../common/http-exception.filter";

// get always misses (null) — forces every AuthGuard check through the real
// DB path unchanged, matching this spec's existing pass/fail expectations;
// set/del are no-ops. Session-cache HIT/invalidation behavior is covered by
// its own spec against a real Redis client (session-cache-revocation.spec.ts).
const mockRedis = {
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue("OK"),
  del: vi.fn().mockResolvedValue(1),
};
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
      // ConfigModule.forRoot + StorageModule: SchoolsService now depends on
      // the real (globally-registered) StorageService for the logo-upload
      // endpoints this spec exercises below. Mirrors portal-payments.controller.spec.ts's
      // own wiring for the same reason.
      imports: [ConfigModule.forRoot({ isGlobal: true }), StorageModule, MockRedisAuthModule, AuthModule, SchoolsModule],
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

  it("PATCH /schools/me with primaryColor: '' — 200, not a validation error (field left unchanged)", async () => {
    // patchSchoolSchema merges onboardingStep2Schema — same preprocess fix,
    // same regression this guards against (docs/deferred.md): pre-fix, this
    // 400'd on the empty-string regex instead of ever reaching the service.
    //
    // Post-fix, "" and an omitted key both parse to undefined, and patchMe's
    // `input.primaryColor !== undefined` gate (schools.service.ts) treats
    // that as "don't touch this field" — correct PATCH partial-update
    // semantics (same as motto/address never overwriting with NULL just
    // because a caller left them out). So this does NOT clear an
    // already-set colour; it's a no-op that no longer errors. Clearing a
    // set colour via PATCH isn't wired yet (no `.nullable()` on this field,
    // unlike paystackSubaccountCode's explicit-null-to-clear pattern above)
    // — out of scope for this fix, which is about the onboarding wizard
    // blocking a first-time skip, not about clearing an existing value.
    const set = await request(app.getHttpServer())
      .patch("/api/v1/schools/me")
      .set(withAuth(ownerToken))
      .send({ primaryColor: "#123456" });
    expect(set.status).toBe(200);
    expect(set.body.primaryColor).toBe("#123456");

    const noOp = await request(app.getHttpServer())
      .patch("/api/v1/schools/me")
      .set(withAuth(ownerToken))
      .send({ primaryColor: "" });
    expect(noOp.status).toBe(200);
    expect(noOp.body.primaryColor).toBe("#123456");
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

  // Regression for docs/deferred.md's "Step 2 branding form: empty fields
  // fail Zod validation" — a real browser submit sends primaryColor: "" (the
  // input's empty string), not an absent key, so the {} case above alone
  // doesn't prove the bug is fixed. Fresh signup + own token: the shared
  // ownerToken above is already past step 2 by this point in the file's
  // sequential walk, so this reproduces the wizard from scratch instead.
  it("POST /schools/me/onboarding/2 with primaryColor: '' — 200, treated as skipped (not a validation error)", async () => {
    const emptyColorEmail = `empty-color-${runId}@example.test`;
    const signupRes = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send({
        schoolName: "Empty Colour Academy",
        schoolSlug: `empty-color-${runId}`,
        ownerFirstName: "Empty",
        ownerLastName: "Colour",
        ownerEmail: emptyColorEmail,
        ownerPhone: `+23484${phoneSuffix}`,
        password: ownerPassword,
        ndprConsent: true,
      });
    expect(signupRes.status).toBe(201);
    const token = signupRes.body.token;
    schoolIdsToCleanup.add(signupRes.body.school.id);

    await request(app.getHttpServer())
      .post("/api/v1/schools/me/onboarding/1")
      .set(withAuth(token))
      .send({
        name: "Empty Colour Academy",
        phone: `+23485${phoneSuffix}`,
        email: `empty-color-step1-${runId}@example.test`,
      });

    const res = await request(app.getHttpServer())
      .post("/api/v1/schools/me/onboarding/2")
      .set(withAuth(token))
      .send({ primaryColor: "" });
    expect(res.status).toBe(200);
    expect(res.body.school?.onboardingStep).toBe(2);
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

  // ---------------------------------------------------------------------
  // POST /schools/me/logo + GET /schools/me/logo-url — visual/UX overhaul
  // initiative (2026-07-26). Real multipart upload through the real
  // (filesystem-driver) StorageModule this testing module now imports.
  // ---------------------------------------------------------------------

  const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("POST /schools/me/logo without a file — 400 INVALID_UPLOAD", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/schools/me/logo")
      .set(withAuth(ownerToken));
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("INVALID_UPLOAD");
  });

  it("POST /schools/me/logo with a disallowed mimetype — 400 INVALID_LOGO_TYPE", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/schools/me/logo")
      .set(withAuth(ownerToken))
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "logo.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("INVALID_LOGO_TYPE");
  });

  it("GET /schools/me/logo-url before any upload — 404", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/schools/me/logo-url")
      .set(withAuth(ownerToken));
    expect(res.status).toBe(404);
  });

  it("POST /schools/me/logo with a real PNG, then GET /schools/me/logo-url returns a URL", async () => {
    const uploadRes = await request(app.getHttpServer())
      .post("/api/v1/schools/me/logo")
      .set(withAuth(ownerToken))
      .attach("file", PNG_MAGIC_BYTES, { filename: "logo.png", contentType: "image/png" });
    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.logoUrl).toMatch(/logo\.png$/);

    const urlRes = await request(app.getHttpServer())
      .get("/api/v1/schools/me/logo-url")
      .set(withAuth(ownerToken));
    expect(urlRes.status).toBe(200);
    expect(typeof urlRes.body.url).toBe("string");
    expect(urlRes.body.url.length).toBeGreaterThan(0);
  });

  it("POST /schools/me/logo without a bearer token — 401", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/schools/me/logo")
      .attach("file", PNG_MAGIC_BYTES, { filename: "logo.png", contentType: "image/png" });
    expect(res.status).toBe(401);
  });
});
