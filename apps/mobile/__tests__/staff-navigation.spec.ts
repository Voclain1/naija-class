import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// CP8 Gate 3 — a redesign that strands a screen has removed a feature.
//
// expo-router turns every direct child of a Tabs layout into a tab. So a new
// staff folder silently appears in the bar unless the layout names it, and a
// route the layout forgets is still reachable but visually adrift. Both
// failures are invisible to typecheck, to lint and to `expo export` — the
// bundle compiles perfectly either way.
//
// This spec reads the real directory and the real layout, so it fails when
// someone adds a staff surface and forgets the bar, which is exactly how the
// home screen grew into a ten-card list in the first place.

const STAFF_DIR = join(__dirname, "..", "app", "staff");
const LAYOUT = readFileSync(join(STAFF_DIR, "_layout.tsx"), "utf8");

/** Route names under app/staff: folders and .tsx files, minus layouts. */
function staffRoutes(): string[] {
  return readdirSync(STAFF_DIR)
    .filter((entry) => entry !== "_layout.tsx")
    .map((entry) => entry.replace(/\.tsx$/, ""))
    .sort();
}

/** The subset of routes that are folders, i.e. sections with nested screens. */
function sectionFolders(): string[] {
  return readdirSync(STAFF_DIR)
    .filter((entry) => entry !== "_layout.tsx")
    .filter((entry) => statSync(join(STAFF_DIR, entry)).isDirectory())
    .sort();
}

/** Names the layout mentions, and whether each is hidden from the bar. */
function declaredScreens(): Map<string, boolean> {
  const declared = new Map<string, boolean>();
  const pattern = /<Tabs\.Screen\s+name="([^"]+)"([\s\S]*?)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(LAYOUT)) !== null) {
    declared.set(match[1]!, /href:\s*null/.test(match[2]!));
  }
  return declared;
}

describe("staff navigation", () => {
  it("declares EVERY route, so none is stranded or accidentally a tab", () => {
    const declared = declaredScreens();
    const missing = staffRoutes().filter((route) => !declared.has(route));
    expect(missing).toEqual([]);
  });

  it("declares nothing that no longer exists", () => {
    const routes = new Set(staffRoutes());
    const orphans = [...declaredScreens().keys()].filter((name) => !routes.has(name));
    expect(orphans).toEqual([]);
  });

  it("keeps the bar to daily destinations (D29)", () => {
    const visible = [...declaredScreens().entries()]
      .filter(([, hidden]) => !hidden)
      .map(([name]) => name)
      .sort();
    // A bar listing everything is a menu, and a menu in a bar is harder to
    // read than a grid on a page. If this needs to change, change D29 first.
    expect(visible).toEqual(["classes", "gradebook", "index", "lesson-notes"]);
    expect(visible.length).toBeLessThanOrEqual(5);
  });

  it("gives every nested section its own stack", () => {
    // Without a stack inside the folder, expo-router flattens its screens into
    // the tab navigator: each nested screen becomes its own tab, and a pushed
    // detail replaces the bar instead of sitting under it.
    const nested = sectionFolders();
    const withoutLayout = nested.filter((route) => {
      try {
        statSync(join(STAFF_DIR, route, "_layout.tsx"));
        return false;
      } catch {
        return true;
      }
    });
    expect(withoutLayout).toEqual([]);
  });

  it("every section folder has an index screen to land on", () => {
    const nested = sectionFolders();
    const landing = nested.filter((route) => {
      const files = readdirSync(join(STAFF_DIR, route));
      // Either an index, or a single dynamic screen the dashboard links into
      // directly (attendance and report-cards are opened per class arm).
      return !files.includes("index.tsx") && !files.some((f) => f.startsWith("["));
    });
    expect(landing).toEqual([]);
  });
});
