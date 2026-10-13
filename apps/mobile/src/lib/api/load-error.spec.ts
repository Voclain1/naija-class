import { describe, expect, it } from "vitest";

import { ApiError, ApiNetworkError } from "./client";
import { describeLoadError } from "./load-error";

const err = (status: number) => new ApiError(status, { code: "X", message: "x" });

describe("describeLoadError", () => {
  it("a lost connection says so, and can be retried", () => {
    const f = describeLoadError(new ApiNetworkError(), { what: "your classes" });
    expect(f.message).toMatch(/internet connection/);
    expect(f.retry).toBe(true);
  });

  it("a server fault keeps the old sentence, and can be retried", () => {
    expect(describeLoadError(err(500), { what: "your classes" })).toEqual({
      message: "We couldn't load your classes. Try again shortly.",
      retry: true,
    });
  });

  it("an unknown error is treated like a server fault", () => {
    expect(describeLoadError(new Error("boom"), { what: "receipts" }).retry).toBe(true);
  });

  it("a 404 never says try again, and uses the screen's own sentence", () => {
    const f = describeLoadError(err(404), { what: "this report card", notFound: "This report card hasn't been released." });
    expect(f).toEqual({ message: "This report card hasn't been released.", retry: false });
    expect(describeLoadError(err(404), { what: "x" }).message).not.toMatch(/try again/i);
  });

  it("a 403 never says try again", () => {
    const f = describeLoadError(err(403), { what: "your classes" });
    expect(f.retry).toBe(false);
    expect(f.message).toMatch(/administrator/);
    expect(describeLoadError(err(403), { what: "x", forbidden: "Only form teachers." }).message).toBe("Only form teachers.");
  });
});
