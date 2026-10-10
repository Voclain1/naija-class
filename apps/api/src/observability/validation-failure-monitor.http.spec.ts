import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import { Body, Controller, INestApplication, Module, Param, Post } from "@nestjs/common";
import request from "supertest";
import { z } from "zod";

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("./sentry", () => ({ Sentry: { captureMessage, captureException: vi.fn() } }));

import { HttpExceptionFilter } from "../common/http-exception.filter";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { VALIDATION_FAILURE_THRESHOLD } from "./validation-failure-monitor";

// Over real HTTP, so what the filter reads from Express is what is pinned:
// the route TEMPLATE under the global prefix, never the URL with its id.
const termSchema = z.object({ terms: z.array(z.object({ startDate: z.string().date() })) });

@Controller("probe-schools")
class ProbeController {
  @Post(":schoolId/terms")
  save(@Param("schoolId") _id: string, @Body(new ZodValidationPipe(termSchema)) _body: unknown) {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe("Repeated validation failures over HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("raises one warning keyed on the route template and field, with no id or value", async () => {
    const http = request(app.getHttpServer());
    for (let i = 0; i < VALIDATION_FAILURE_THRESHOLD; i++) {
      const res = await http
        .post(`/api/v1/probe-schools/3fa85f64-5717-4562-b3fc-2c963f66af${10 + i}/terms`)
        .send({ terms: [{ startDate: "31/13/2026" }] });
      expect(res.status).toBe(400);
    }
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [summary, context] = captureMessage.mock.calls[0];
    expect(summary).toContain("POST /api/v1/probe-schools/:schoolId/terms");
    expect(context.tags.issue_path).toBe("terms.*.startDate");
    const sent = JSON.stringify(captureMessage.mock.calls);
    expect(sent).not.toContain("3fa85f64");
    expect(sent).not.toContain("31/13/2026");
  });
});
