import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { config } from "./middleware";

// The edge session gate only runs for paths in config.matcher. Three times a new
// (admin) page shipped without a matcher line (/finance and /insights, fixed
// 2026-08-14; /events, /reports and /timetable, fixed 2026-09-14), each time
// despite a comment asking for it. This makes the omission a test failure.
//
// Every top-level directory of the (admin) route group is a URL segment that
// must be gated. Files (layout.tsx, loading.tsx) are not routes.
describe("edge middleware matcher", () => {
  it("gates every (admin) route directory", () => {
    const adminDir = join(__dirname, "app", "(admin)");
    const routes = readdirSync(adminDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(routes.length).toBeGreaterThan(0);
    const missing = routes.filter((r) => !config.matcher.includes(`/${r}/:path*`));
    expect(missing, `(admin) routes missing from middleware config.matcher: ${missing.join(", ")}`).toEqual([]);
  });
});
