import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// No accent borders, anywhere in the product (decided 2026-10-02).
//
// An "accent border" is a thick or coloured edge on ONE side of a box — the
// emerald stripe down the left of an unread announcement, a red edge on a
// behaviour concern, a gold rule beside a quote. The owner asked for none of
// them, in any app. When a box needs to say something (unread, a warning, a
// concern) it says it in WORDS — a "New" badge, a coloured label — which also
// does not depend on telling one colour from another.
//
// This spec is the rule, so it cannot quietly come back. It scans every
// workspace that produces UI, across all three ways an edge can be written:
//
//   Tailwind      border-l-4, border-l-primary, border-s-2, border-r-[3px] …
//   React Native  borderLeftWidth, borderLeftColor, borderStartWidth …
//   CSS strings   border-left: 3px solid …  (receipts and other HTML the API renders)
//
// Deliberately ALLOWED: a bare 1px `border-l` / `border-r` (table gridlines,
// the divider inside a split button) and `border-r-0`. Those are structure in a
// neutral colour, not an accent on a box.

const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCANNED = [
  "apps/web/src",
  "apps/portal/src",
  "apps/mobile/app",
  "apps/mobile/src",
  "packages/ui/src",
  "apps/api/src",
];

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "generated", ".expo"]);
const EXTENSIONS = [".ts", ".tsx", ".css"];
const SELF = "apps/web/src/no-accent-borders.spec.ts";

const RULES: { name: string; pattern: RegExp }[] = [
  // One side, width 2+ or arbitrary: border-l-2, border-s-4, border-r-[3px].
  { name: "Tailwind one-side width", pattern: /(?<![\w-])border-[lrse]-(?:[2-9]|\[)/ },
  // One side, colour: border-l-primary, border-l-amber-500, border-e-destructive.
  { name: "Tailwind one-side colour", pattern: /(?<![\w-])border-[lrse]-(?!0(?![\w-]))[a-z]/ },
  // React Native one-side width or colour.
  { name: "React Native one-side border", pattern: /\bborder(?:Left|Right|Start|End)(?:Width|Color)\b/ },
  // CSS one-side border declaration.
  { name: "CSS one-side border", pattern: /border-(?:left|right|inline-start|inline-end)(?:-width|-color)?\s*:/ },
];

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (EXTENSIONS.some((ext) => path.endsWith(ext))) out.push(path);
  }
}

describe("no accent borders", () => {
  it("no UI workspace draws a coloured or thick edge on one side of a box", () => {
    const files: string[] = [];
    for (const dir of SCANNED) walk(join(REPO_ROOT, dir), files);
    // Proof the scan reached the code, so an empty result means something.
    expect(files.length).toBeGreaterThan(200);

    const offences: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file);
      if (rel === SELF) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const rule of RULES) {
            if (rule.pattern.test(line)) offences.push(`${rel}:${index + 1} (${rule.name}): ${line.trim()}`);
          }
        });
    }
    expect(offences).toEqual([]);
  });

  it("the patterns catch what they are meant to, and spare the gridlines", () => {
    const caught = (line: string) => RULES.some((rule) => rule.pattern.test(line));
    // The forms that were removed on 2026-10-02.
    expect(caught('"border-l-4 border-l-primary"')).toBe(true);
    expect(caught('"rounded-md border-l-2 border-primary"')).toBe(true);
    expect(caught("border-l-amber-500")).toBe(true);
    expect(caught("border-r-[3px]")).toBe(true);
    expect(caught("{ borderLeftWidth: 3, borderLeftColor: colors.primary }")).toBe(true);
    expect(caught(".words { border-left: 3px solid var(--brand); }")).toBe(true);
    // Structure that stays.
    expect(caught('"border-b border-l p-2 text-left"')).toBe(false);
    expect(caught('"h-8 w-9 border-r text-xs last:border-r-0"')).toBe(false);
    expect(caught('"rounded-l-none border-l border-primary-foreground/25"')).toBe(false);
    expect(caught('"rounded-lg border bg-card p-4"')).toBe(false);
  });
});
