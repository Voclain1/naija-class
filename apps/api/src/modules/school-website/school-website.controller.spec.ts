import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { Global, Module, INestApplication } from "@nestjs/common";
import request from "supertest";

import { basePrisma } from "@school-kit/db";

import { REDIS_AUTH_CLIENT } from "../../common/auth/redis-auth.provider";
import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { StorageModule } from "../../common/storage/storage.module";
import { AuthModule } from "../auth/auth.module";
import { SchoolWebsiteModule } from "./school-website.module";

// HTTP spec for the photo upload's two shapes: the web editor sends `file`
// and `thumb` parts; the staff app's native uploader sends one file per
// request, so it sends the thumbnail as the `thumbBase64` field. Everything
// else about uploads is in school-website.service.spec.ts.

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

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe("SchoolWebsiteController photo upload", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const phoneSuffix = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  let app: INestApplication;
  let token: string;
  let schoolId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), StorageModule, MockRedisAuthModule, AuthModule, SchoolWebsiteModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const signup = await request(app.getHttpServer())
      .post("/api/v1/auth/signup-owner")
      .send({
        schoolName: "Website Upload Academy",
        schoolSlug: `wu-${runId}`,
        ownerFirstName: "Web",
        ownerLastName: "Owner",
        ownerEmail: `wu-${runId}@example.test`,
        ownerPhone: `+23484${phoneSuffix}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      });
    expect(signup.status).toBe(201);
    token = signup.body.token;
    schoolId = signup.body.school.id;
  });

  afterAll(async () => {
    await app.close();
    await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  const upload = () =>
    request(app.getHttpServer()).post("/api/v1/school-website/photos").set({ Authorization: `Bearer ${token}` });

  it("takes the thumbnail as a part (the web editor)", async () => {
    const res = await upload()
      .field("kind", "GALLERY")
      .field("noPupils", "true")
      .attach("file", JPEG, { filename: "a.jpg", contentType: "image/jpeg" })
      .attach("thumb", JPEG, { filename: "a-thumb.jpg", contentType: "image/jpeg" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.kind).toBe("GALLERY");
  });

  it("takes the thumbnail as base64 beside one file (the staff app)", async () => {
    const res = await upload()
      .field("kind", "GALLERY")
      .field("noPupils", "true")
      .field("caption", "Our new library")
      .field("thumbBase64", JPEG.toString("base64"))
      .attach("file", JPEG, { filename: "a.jpg", contentType: "image/jpeg" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.caption).toBe("Our new library");
  });

  it("checks a base64 thumbnail like any other: not a JPEG is refused", async () => {
    const res = await upload()
      .field("kind", "GALLERY")
      .field("noPupils", "true")
      .field("thumbBase64", PNG.toString("base64"))
      .attach("file", JPEG, { filename: "a.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("INVALID_FILE_TYPE");
  });

  it("refuses text that is not base64, and an upload with no thumbnail", async () => {
    const bad = await upload()
      .field("kind", "GALLERY")
      .field("noPupils", "true")
      .field("thumbBase64", "not base64!")
      .attach("file", JPEG, { filename: "a.jpg", contentType: "image/jpeg" });
    expect(bad.status).toBe(400);

    const none = await upload()
      .field("kind", "GALLERY")
      .field("noPupils", "true")
      .attach("file", JPEG, { filename: "a.jpg", contentType: "image/jpeg" });
    expect(none.status).toBe(400);
    expect(none.body.error?.code).toBe("INVALID_UPLOAD");
  });

  it("still needs the no-pupils tick", async () => {
    const res = await upload()
      .field("kind", "GALLERY")
      .field("thumbBase64", JPEG.toString("base64"))
      .attach("file", JPEG, { filename: "a.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
  });
});
