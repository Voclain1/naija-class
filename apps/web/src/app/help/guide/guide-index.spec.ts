import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import { describe, expect, it } from "vitest";

import { GUIDE_SECTIONS } from "../../../../../../packages/ai/src/help-guide/guide-index.generated";
import { renderGuideIndexModule, splitGuide } from "../../../../../../packages/ai/src/help-guide/guide-sections";

// FD-5a (docs/reviews/agentic-implementation-plan.md §3.3): the help
// assistant cites the guide as /help/guide#anchor. Two things must hold, and
// both are checked against what THIS page really renders (react-markdown +
// rehype-slug, the same plugins page.tsx uses), not against a copy of its
// rules:
//   1. every anchor in the index is a heading id on the page, in order;
//   2. the committed index is exactly what the guide produces today. A guide
//      edit without `pnpm --filter @school-kit/ai help-index` fails here.

const repo = (p: string) => fileURLToPath(new URL(`../../../../../../${p}`, import.meta.url));
const guide = readFileSync(repo("docs/onboarding-guide.md"), "utf8");
const committed = readFileSync(repo("packages/ai/src/help-guide/guide-index.generated.ts"), "utf8");

function renderedHeadingIds(markdown: string): string[] {
  const html = renderToStaticMarkup(createElement(ReactMarkdown, { rehypePlugins: [rehypeSlug] }, markdown));
  return [...html.matchAll(/<h[1-6] id="([^"]*)"/g)].map((m) => m[1]!);
}

describe("help guide index (FD-5a)", () => {
  const pageIds = renderedHeadingIds(guide);

  it("has one entry per heading on /help/guide, with the id the page gives it", () => {
    expect(pageIds.length).toBeGreaterThan(20);
    expect(GUIDE_SECTIONS.map((s) => s.anchor)).toEqual(pageIds);
  });

  it("is up to date with docs/onboarding-guide.md", () => {
    let i = 0;
    const fresh = renderGuideIndexModule(splitGuide(guide, () => pageIds[i++]!));
    expect(i).toBe(pageIds.length);
    expect(committed, "run `pnpm --filter @school-kit/ai help-index` and commit the result").toBe(fresh);
  });

  it("every link inside the guide to #anchor lands on a real heading", () => {
    const targets = [...guide.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => m[1]!);
    expect(targets.length).toBeGreaterThan(10);
    expect(targets.filter((t) => !pageIds.includes(t))).toEqual([]);
  });

  it("a repeated heading gets the numbered id the page gives it", () => {
    const md = "# FAQ\n\nfirst\n\n## FAQ\n\nsecond\n";
    const ids = renderedHeadingIds(md);
    expect(ids).toEqual(["faq", "faq-1"]);
    let i = 0;
    expect(splitGuide(md, () => ids[i++]!).map((s) => [s.anchor, s.text])).toEqual([
      ["faq", "first"],
      ["faq-1", "second"],
    ]);
  });
});
