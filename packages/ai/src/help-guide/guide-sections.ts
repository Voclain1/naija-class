// ---------------------------------------------------------------------------
// FD-5a — the help guide split into sections (docs/reviews/
// agentic-implementation-plan.md §3.3).
//
// docs/onboarding-guide.md is the in-app Getting started guide, rendered at
// /help/guide by react-markdown + rehype-slug. Every heading there gets an id,
// and that id is what a citation links to. So the index is split at EVERY
// heading, in document order, and each section carries the anchor the page
// will give that heading.
//
// The anchor function is passed in rather than imported: it must be exactly
// the slugger rehype-slug uses (github-slugger, which numbers repeats: "faq",
// "faq-1"). The generator script passes github-slugger itself; the web spec
// checks the result against the ids the real page renders. This file has no
// dependencies, so the runtime (apps/api) never loads a slugger at all.
// ---------------------------------------------------------------------------

export interface GuideSection {
  /** The heading's id on /help/guide, e.g. "step-4-add-your-students". */
  readonly anchor: string;
  /** Heading text as a reader sees it (inline markdown removed). */
  readonly title: string;
  /** 1 for "#", 2 for "##", and so on. */
  readonly level: number;
  /** Titles of the enclosing headings, outermost first. */
  readonly parents: readonly string[];
  /** The section's own text, up to the next heading of any level, as plain-ish text. */
  readonly text: string;
  /**
   * False for a heading with no text of its own, and for a list of links to
   * other sections (the guide's contents): every question would match it,
   * and it answers none. It keeps its anchor, so a link to it still checks.
   */
  readonly searchable: boolean;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const LINK_ONLY_ITEM = /^\s*([-*+]|\d+\.)\s+\[[^\]]+\]\(#[^)]*\)\s*(\(.*\))?\s*$/;

/** Inline markdown to the plain text a reader sees, as a heading's title or a section's body. */
export function plainText(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → link text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Splits the guide at every heading. `anchorFor` is called once per heading,
 * in document order, with the heading's plain text, and must behave like
 * rehype-slug's github-slugger (including its numbering of repeated titles).
 */
export function splitGuide(markdown: string, anchorFor: (title: string) => string): GuideSection[] {
  const sections: Array<{ anchor: string; title: string; level: number; parents: string[]; body: string[] }> = [];
  const stack: Array<{ level: number; title: string }> = [];
  let inFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING.exec(line);
    if (m) {
      const level = m[1]!.length;
      const title = plainText(m[2]!);
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
      sections.push({ anchor: anchorFor(title), title, level, parents: stack.map((s) => s.title), body: [] });
      stack.push({ level, title });
    } else if (sections.length > 0) {
      sections[sections.length - 1]!.body.push(line);
    }
  }

  return sections.map((s) => {
    const lines = s.body.filter((l) => l.trim().length > 0 && !RULE.test(l));
    const linkOnly = lines.filter((l) => LINK_ONLY_ITEM.test(l)).length;
    const text = lines
      .map((l) => plainText(l.replace(/^\s*([-*+]|\d+\.)\s+/, "")))
      .filter((l) => l.length > 0)
      .join("\n");
    return {
      anchor: s.anchor,
      title: s.title,
      level: s.level,
      parents: s.parents,
      text,
      searchable: text.length > 0 && !(lines.length >= 3 && linkOnly / lines.length >= 0.8),
    };
  });
}

/**
 * The generated module's exact text. Shared by the generator and the CI
 * staleness check, so "regenerate and compare" is a byte comparison.
 */
export function renderGuideIndexModule(sections: readonly GuideSection[]): string {
  return [
    "// GENERATED from docs/onboarding-guide.md by packages/ai/scripts/generate-help-index.ts.",
    "// Do not edit. Run `pnpm --filter @school-kit/ai help-index` after changing the guide.",
    'import type { GuideSection } from "./guide-sections.js";',
    "",
    `export const GUIDE_SECTIONS: readonly GuideSection[] = ${JSON.stringify(sections, null, 2)};`,
    "",
  ].join("\n");
}
