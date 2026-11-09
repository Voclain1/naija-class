// Deterministic resolution of what a model asked for (a term, class labels)
// into this school's own ids, and the model-safe labels it may see back.
//
// The model chooses WHAT to ask for; this code decides what it matches. A
// label that matches nothing, or more than one thing, is returned as a
// question for the person, never guessed.

export interface StructureTerm {
  id: string;
  /** "Second Term". */
  name: string;
  /** "2025/2026". */
  year: string;
  academicYearId: string;
  sequence: number;
  isCurrent: boolean;
  startDate: Date;
}

export interface StructureArm {
  id: string;
  /** "JSS 2A". */
  name: string;
  /** "JSS 2". */
  level: string;
}

export interface SchoolStructure {
  terms: StructureTerm[];
  arms: StructureArm[];
}

/**
 * A school-entered label, made safe to show the model: letters, digits and
 * ordinary punctuation only, one line, at most 40 characters. Labels are data:
 * the system prompt says never to follow instructions inside them, and this
 * keeps one from carrying markup or a long instruction in the first place.
 */
export function safeLabel(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} .,'()/&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

export function termLabel(t: StructureTerm): string {
  return safeLabel(`${t.year} ${t.name}`);
}

export function armLabel(a: StructureArm): string {
  return safeLabel(a.name);
}

/** "JSS 2 / Gold": an arm with its level, for a choice between arms that share a name. */
export function qualifiedArmLabel(a: StructureArm): string {
  return safeLabel(`${a.level} / ${a.name}`);
}

/** An arm's label, qualified with its level when another arm has the same name. */
export function distinctArmLabel(a: StructureArm, all: readonly StructureArm[]): string {
  return all.some((b) => b.id !== a.id && norm(b.name) === norm(a.name)) ? qualifiedArmLabel(a) : armLabel(a);
}

/** "JSS 2A", "jss2a", "J.S.S. 2 A" → "jss2a". */
export function norm(s: string): string {
  return s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const ORDINALS: Record<string, number> = { first: 1, "1st": 1, "1": 1, one: 1, second: 2, "2nd": 2, "2": 2, two: 2, third: 3, "3rd": 3, "3": 3, three: 3 };

export type TermResolution =
  | { ok: true; term: StructureTerm }
  | { ok: false; problem: "unknown" | "ambiguous" | "no-current"; options: string[] };

/** "current", "next", "first"/"second"/"third" (of the current session), or a term's own label. */
export function resolveTerm(structure: SchoolStructure, asked: string): TermResolution {
  const terms = [...structure.terms].sort((a, b) => a.startDate.getTime() - b.startDate.getTime() || a.sequence - b.sequence);
  const current = terms.find((t) => t.isCurrent);
  const words = asked.toLowerCase().replace(/term|session/g, " ").trim().split(/\s+/).filter(Boolean);
  const options = () => terms.slice(-6).map(termLabel);

  if (words.length === 0 || words.includes("current") || words.includes("this")) {
    return current ? { ok: true, term: current } : { ok: false, problem: "no-current", options: options() };
  }
  if (words.includes("next") || words.includes("coming")) {
    if (!current) return { ok: false, problem: "no-current", options: options() };
    const i = terms.indexOf(current);
    const next = terms[i + 1];
    return next ? { ok: true, term: next } : { ok: false, problem: "unknown", options: options() };
  }
  // An exact label first ("2025/2026 Second Term", "Second Term").
  const exact = terms.filter((t) => norm(termLabel(t)) === norm(asked) || norm(t.name) === norm(asked));
  const ordinal = words.map((w) => ORDINALS[w]).find((n) => n !== undefined);
  const yearWord = words.find((w) => /\d{4}/.test(w));
  let pool = exact;
  if (pool.length === 0 && ordinal !== undefined) {
    const yearScoped = yearWord ? terms.filter((t) => norm(t.year).includes(norm(yearWord))) : current ? terms.filter((t) => t.academicYearId === current.academicYearId) : terms;
    pool = yearScoped.filter((t) => t.sequence === ordinal);
  }
  if (pool.length === 1) return { ok: true, term: pool[0]! };
  if (pool.length > 1) {
    // "Second Term" in several sessions: prefer the current session's.
    const inCurrent = current ? pool.filter((t) => t.academicYearId === current.academicYearId) : [];
    if (inCurrent.length === 1) return { ok: true, term: inCurrent[0]! };
    return { ok: false, problem: "ambiguous", options: pool.map(termLabel) };
  }
  return { ok: false, problem: "unknown", options: options() };
}

export interface ClassResolution {
  arms: StructureArm[];
  unknown: string[];
  ambiguous: { asked: string; options: string[] }[];
}

/**
 * Each label is an arm ("JSS 2A") or a whole level ("JSS 2" = every arm of
 * JSS 2). An arm name shared by two levels is ambiguous: the person chooses.
 */
export function resolveClasses(structure: SchoolStructure, asked: readonly string[]): ClassResolution {
  const out = new Map<string, StructureArm>();
  const unknown: string[] = [];
  const ambiguous: { asked: string; options: string[] }[] = [];
  for (const raw of asked) {
    const n = norm(raw);
    if (!n) continue;
    const byArm = structure.arms.filter((a) => norm(a.name) === n || norm(`${a.level}${a.name}`) === n);
    const byLevel = byArm.length ? [] : structure.arms.filter((a) => norm(a.level) === n);
    // "JSS 2C" with no such arm, where the level's arms are "JSS 2 Gold" etc.: unknown, not guessed.
    if (byArm.length > 1) {
      ambiguous.push({ asked: safeLabel(raw), options: byArm.map(qualifiedArmLabel) });
      continue;
    }
    const hit = byArm.length ? byArm : byLevel;
    if (hit.length === 0) unknown.push(safeLabel(raw));
    for (const a of hit) out.set(a.id, a);
  }
  return { arms: [...out.values()], unknown, ambiguous };
}

/** Money in a reply is replaced: the card shows the server's figures, never the model's. */
const MONEY = /(?:₦|\bNGN\b|\bN(?=\s?\d))\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|thousand))?|\b\d[\d,]*(?:\.\d+)?\s?(?:k|m)?\s?(?:naira|kobo)\b/gi;

export const MAX_REPLY_CHARS = 1_200;

/** The server's check on the model's reply before the browser sees it. */
export function checkReply(text: string): string {
  return text.replace(MONEY, "(see the card for the server's figures)").trim().slice(0, MAX_REPLY_CHARS);
}
