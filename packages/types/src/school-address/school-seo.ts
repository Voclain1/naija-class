import type { SchoolPublicDto } from "./school-address.dto.js";

// Titles and descriptions for a school's public pages (2026-10-25,
// docs/modules/school-website.md "Search"). Pure, so the portal and the
// editor's "How you appear on Google" preview say exactly the same thing.

/** Google shows about 60 characters of a title and 155 of a description. */
export const SEO_TITLE_MAX = 65;
export const SEO_DESCRIPTION_MAX = 160;

const STATE_WORDS = /\b(state|nigeria|f\.?c\.?t\.?)\b\.?/gi;

/**
 * A town from a typed address: its last part that is not a state or the
 * country. "14 Ogui Road, Enugu, Enugu State" → "Enugu". Null when unsure.
 */
export function townFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address
    .split(/[,\n]/)
    .map((p) => p.replace(STATE_WORDS, "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 1 && !/\d/.test(p));
  const last = parts[parts.length - 1];
  return last && last.length <= 40 ? last : null;
}

/** Shortens to `max` characters on a word boundary, with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,.;:\s]+$/, "")}…`;
}

function levelsPhrase(levels: string[]): string | null {
  if (levels.length === 0) return null;
  if (levels.length === 1) return levels[0]!;
  return `${levels[0]} to ${levels[levels.length - 1]!.replace(/^Senior /, "")}`;
}

/** "Greenfield Academy, Enugu | Nursery to secondary | Admissions open", kept short. */
export function schoolPageTitle(school: Pick<SchoolPublicDto, "name" | "admissionsOpen" | "seo">): string {
  const head = school.seo.town && !school.name.toLowerCase().includes(school.seo.town.toLowerCase())
    ? `${school.name}, ${school.seo.town}`
    : school.name;
  const levels = levelsPhrase(school.seo.levels);
  const admissions = school.admissionsOpen ? "Admissions open" : null;
  // Longest first, then without the levels, then the name alone: "Admissions
  // open" is what a searching parent most wants to see.
  for (const parts of [[head, levels, admissions], [head, admissions], [head, levels]]) {
    const title = parts.filter(Boolean).join(" | ");
    if (title.length <= SEO_TITLE_MAX) return title;
  }
  return head.length <= SEO_TITLE_MAX ? head : school.name;
}

/** The school's own description, or one composed from what it has filled in. */
export function schoolPageDescription(
  school: Pick<SchoolPublicDto, "name" | "motto" | "admissionsOpen" | "seo"> & { website: { cover: { welcome: string | null } | null } },
): string {
  if (school.seo.description) return clip(school.seo.description, SEO_DESCRIPTION_MAX);
  const lv = school.seo.levels.map((l) => l.toLowerCase());
  const levels = lv.length === 0 ? null : lv.length === 1 ? lv[0]! : `${lv.slice(0, -1).join(", ")} and ${lv[lv.length - 1]}`;
  const where = school.seo.town ? ` in ${school.seo.town}` : "";
  const what = levels ? `${school.name} is a ${levels} school${where}.` : `${school.name}${where ? `, a school${where}.` : "."}`;
  const extra = school.website.cover?.welcome ?? school.motto ?? "";
  const tail = school.admissionsOpen ? " Admissions are open: apply online." : " News, events and how to reach the school.";
  return clip(`${what} ${extra}${extra && !/[.!?]$/.test(extra) ? "." : ""}${tail}`, SEO_DESCRIPTION_MAX);
}
