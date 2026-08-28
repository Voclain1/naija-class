import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-text invariants for the forced-sign-out path.
//
// These assert on the SHAPE OF THE CODE, not on behaviour, because the things
// they protect cannot be reached from apps/web's node-environment Vitest
// runner (no DOM tests, by standing decision) and are expensive to reach from
// Playwright. Same technique as lib/finance/finance-ux-invariants.spec.ts.
//
// Each one below was verified to FAIL when its guard is removed — that check
// is the whole reason the file is worth having. A source-text test that has
// never been shown to bite is decoration.

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

// Every file that registers a beforeunload guard for unsaved work. Adding a
// new one without wiring it up should fail here rather than ship a dialog
// whose "Stay" cannot stay.
const GUARDED_SURFACES: { label: string; path: string }[] = [
  { label: "gradebook grid", path: "../../components/teacher/gradebook/gradebook-grid.tsx" },
  { label: "class-subject matrix", path: "../../components/settings/academic/class-subject-matrix.tsx" },
  { label: "lesson plan editor", path: "../../app/(teacher)/teacher/lesson-plans/[id]/page.tsx" },
  { label: "teacher attendance", path: "../../app/(teacher)/teacher/attendance/page.tsx" },
];

describe("every beforeunload guard stands down for a forced sign-out", () => {
  it.each(GUARDED_SURFACES)("$label", ({ path }) => {
    const source = read(path);
    // Only meaningful for a file that actually registers a guard — if this
    // stops matching, the list above is stale and needs re-deriving.
    expect(source).toContain('addEventListener("beforeunload"');
    expect(source).toContain("isAuthForcedNavigation()");
  });

  it("the list is complete — no beforeunload guard exists outside it", () => {
    // Guards against the quiet failure mode this whole file exists to prevent:
    // someone adds a fifth dirty surface with its own hand-rolled guard, and
    // the four assertions above keep passing while the new one offers a "Stay"
    // that cannot stay. So walk the tree rather than trusting the list.
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const found: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".spec.")) {
          if (readFileSync(full, "utf8").includes('addEventListener("beforeunload"')) {
            found.push(full);
          }
        }
      }
    };
    walk(root);

    const known = new Set(
      GUARDED_SURFACES.map(({ path }) => fileURLToPath(new URL(path, import.meta.url))),
    );
    const unlisted = found.filter((f) => !known.has(f));
    expect(unlisted, "a beforeunload guard exists that this spec does not check").toEqual([]);
    expect(found).toHaveLength(GUARDED_SURFACES.length);
  });
});

describe("the forced navigation marks itself before it starts", () => {
  const provider = read("./auth-provider.tsx");

  it("calls beginAuthForcedNavigation in the 401 handler", () => {
    expect(provider).toContain("beginAuthForcedNavigation(");
  });

  it("marks BEFORE window.location.replace, not after", () => {
    // Ordering is the whole fix. beforeunload fires synchronously INSIDE
    // location.replace(), so a mark that lands afterwards is never read and
    // the dialog appears exactly as it did before.
    const mark = provider.indexOf("beginAuthForcedNavigation(");
    const replace = provider.indexOf("window.location.replace(target)");
    expect(mark).toBeGreaterThan(-1);
    expect(replace).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(replace);
  });

  it("still clears the stored token — suppression must not resurrect the credential", () => {
    expect(provider).toContain("clearStoredToken()");
  });
});

describe("RequireAuth's guest redirect carries the parked reason", () => {
  const requireAuth = read("../../components/auth/require-auth.tsx");

  it("reads the reason instead of hard-coding null", () => {
    // Before this fix the guest branch passed `reason: null`, so whenever it
    // won the race against the forced navigation the explanation vanished.
    expect(requireAuth).toContain("consumeSessionEndReason()");
    expect(requireAuth).not.toMatch(/buildLoginUrl\(\{\s*reason:\s*null/);
  });
});

describe("the bulk student loop stops when the session is gone", () => {
  const form = read("../../components/students/bulk-student-form.tsx");

  it("checks for a terminal auth failure", () => {
    expect(form).toContain("isTerminalAuthFailure(");
  });

  it("breaks out of the loop rather than continuing", () => {
    // The defect: the catch swallowed a 401 into that row's status cell and
    // the loop carried on, firing one doomed request per remaining row.
    const check = form.indexOf("isTerminalAuthFailure(");
    expect(check).toBeGreaterThan(-1);
    // The break belongs to this branch — look only at the text it opens.
    const branch = form.slice(check, check + 1200);
    expect(branch).toContain("break;");
  });

  it("uses the signed-out notice, not the generic fix-your-rows copy", () => {
    expect(form).toContain("partialSaveNotice(");
  });
});
