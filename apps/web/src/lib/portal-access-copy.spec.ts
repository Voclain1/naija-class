import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const studentPortalAccessSource = readFileSync(
  resolve(process.cwd(), "../portal/src/components/student-portal-access.tsx"),
  "utf8",
);

describe("guardian student-access fallback copy", () => {
  it("does not expose a raw HTTP status when the response has no safe message", () => {
    expect(studentPortalAccessSource).toContain("return `${fallback} Try again.`;");
    expect(studentPortalAccessSource).not.toContain("(error ${res.status})");
  });
});
