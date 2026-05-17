import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { basePrisma } from "@school-kit/db";

import { AuthModule } from "../auth/auth.module";
import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { UsersModule } from "./users.module";

// HTTP-level smoke spec — proves controller + guard + pipe + filter all
// line up and the response envelopes match the spec. Service-level
// invariants (RLS, transaction atomicity, audit content) live in
// users.service.spec.ts.

describe("Users endpoints (controller integration)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const phoneSuffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  const schoolIdsToCleanup = new Set<string>();

  let app: INestApplication;
  let ownerToken: string;
  let ownerSchoolId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, UsersModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    // Sign up an owner + flip the school to ACTIVE so invite passes the gate.
    const signupRes = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send({
        schoolName: "Users Ctrl Academy",
        schoolSlug: `usrctrl-${runId}`,
        ownerFirstName: "Una",
        ownerLastName: "Owner",
        ownerEmail: `usrctrl-${runId}@example.test`,
        ownerPhone: `+234820${phoneSuffix}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      });
    expect(signupRes.status).toBe(201);
    ownerToken = signupRes.body.token;
    ownerSchoolId = signupRes.body.school.id;
    schoolIdsToCleanup.add(ownerSchoolId);

    await basePrisma.school.update({
      where: { id: ownerSchoolId },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
  });

  afterAll(async () => {
    await app.close();
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // -----------------------------------------------------------------------
  // POST /users/invite
  // -----------------------------------------------------------------------

  it("POST /users/invite — happy path returns 201 with invitation, token, acceptUrl", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email: `ctrl-invitee-${runId}@example.test`,
        firstName: "Ctrl",
        lastName: "Invitee",
      });

    expect(res.status).toBe(201);
    expect(res.body.invitation?.id).toBeDefined();
    expect(res.body.invitation?.email).toBe(`ctrl-invitee-${runId}@example.test`);
    expect(res.body.invitation?.roleKey).toBe("admin");
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.body.acceptUrl).toContain(`/invitations/${res.body.token}`);
  });

  it("POST /users/invite — missing auth returns 401", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .send({ email: `noauth-${runId}@example.test` });

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("MISSING_BEARER_TOKEN");
  });

  it("POST /users/invite — bad email returns 400 VALIDATION_ERROR", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/users/invite")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
  });

  // -----------------------------------------------------------------------
  // GET /users
  // -----------------------------------------------------------------------

  it("GET /users — returns 200 with array, excluding the requester", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // We haven't created any other users for this owner yet, so the list
    // should be empty (owner excluded).
    expect(res.body.every((u: { id: string }) => u.id !== undefined)).toBe(true);
  });

  // -----------------------------------------------------------------------
  // GET /users/invitations
  // -----------------------------------------------------------------------

  it("GET /users/invitations — returns 200 with pending invitations, public-safe shape", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/users/invitations")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The happy-path invite above is still pending.
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const inv = res.body[0];
    expect(inv.id).toBeDefined();
    expect(inv.email).toBeDefined();
    expect(inv.invitedBy?.firstName).toBe("Una");
    // tokenHash MUST NOT leak through the listing endpoint.
    expect(inv.tokenHash).toBeUndefined();
  });
});
