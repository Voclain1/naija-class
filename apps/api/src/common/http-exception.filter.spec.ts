import { describe, expect, it, beforeEach, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { NotFoundError, ValidationError } from "@school-kit/types";

// Mock the Sentry re-export at the path the filter imports it from. We
// don't care about the real SDK in unit tests — only that capture is
// invoked exactly when an unexpected exception lands and never otherwise.
//
// vi.mock is hoisted to the top of the file, so any reference inside its
// factory has to be hoisted too — that's what vi.hoisted is for. A bare
// `const captureException = vi.fn()` outside vi.hoisted would TDZ-error
// because the factory runs before the const initialiser.
const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("../observability/sentry", () => ({
  Sentry: { captureException },
}));

// Import after the mock so the filter binds to the mocked Sentry symbol.
import { HttpExceptionFilter } from "./http-exception.filter";

function makeHost(method = "POST", url = "/api/v1/test") {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const response = { status, json };
  const request = { method, originalUrl: url };
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    },
    response,
    status,
    json,
  };
}

describe("HttpExceptionFilter — Sentry capture branching", () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    captureException.mockReset();
    filter = new HttpExceptionFilter();
  });

  it("does NOT capture BaseError subclasses (expected, modelled errors)", () => {
    const { host, status, json } = makeHost();
    filter.catch(new ValidationError("missing field"), host as never);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does NOT capture a 404 BaseError either", () => {
    const { host } = makeHost();
    filter.catch(new NotFoundError("nope"), host as never);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does NOT capture NestJS HttpException (e.g., guard rejections, 404s)", () => {
    const { host, status } = makeHost();
    filter.catch(new HttpException("nope", 404), host as never);
    expect(status).toHaveBeenCalledWith(404);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("DOES capture a plain Error (unexpected/internal)", () => {
    const { host, status } = makeHost("POST", "/api/v1/oops");
    const err = new Error("something exploded");
    filter.catch(err, host as never);
    expect(status).toHaveBeenCalledWith(500);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(err, {
      extra: { method: "POST", url: "/api/v1/oops" },
    });
  });

  it("DOES capture non-Error throws (string, object) as unexpected", () => {
    const { host } = makeHost();
    filter.catch("a bare string was thrown", host as never);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
