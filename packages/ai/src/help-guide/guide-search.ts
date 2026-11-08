import { GUIDE_SECTIONS } from "./guide-index.generated.js";
import type { GuideSection } from "./guide-sections.js";

// ---------------------------------------------------------------------------
// FD-5a — lexical search over the help guide (BM25). In code, over a corpus
// built from the repository's own guide: no embedding vendor, no network, no
// school's data. The same question always gets the same sections, which is
// what makes the help assistant's citations reviewable.
//
// A heading's words count three times: "How do I add parents?" should find
// "Step 10. Add parents" before a section that mentions parents in passing.
// On top of that, a section gains up to TITLE_MATCH_BONUS for the share of
// the question's words its heading holds, so a short, generic heading ("Who
// does what in your school") still wins when it is the question asked.
// ---------------------------------------------------------------------------

export interface GuideHit {
  readonly anchor: string;
  readonly title: string;
  /** "Part 1 — Setting up your school › Step 4. Add your students". */
  readonly path: string;
  /** The section's text, cut to `maxExcerptChars`. */
  readonly excerpt: string;
  readonly score: number;
}

export interface GuideSearchOptions {
  /** How many sections to return. Default 3, at most 8. */
  readonly limit?: number;
  /** Characters of section text per hit. Default 1,200. */
  readonly maxExcerptChars?: number;
}

const K1 = 1.2;
const B = 0.75;
const TITLE_WEIGHT = 3;
const TITLE_MATCH_BONUS = 5;
const MAX_LIMIT = 8;

// Words that carry no meaning for finding a section. Kept short on purpose:
// "not", "no" and "who" change what a question is about, so they stay.
const STOPWORDS = new Set(
  (
    "a an and are as at be but by can do does for from how i if in into is it its me my of on or our so " +
    "that the their them then there these they this to us was we what when where which will with you your " +
    "about after all also another any every get got has have her his just keep keeps need other so some " +
    "still too want very"
  ).split(" "),
);

// The words staff use for what the guide calls something else. Applied to
// the QUESTION only, as extra terms beside the person's own words (which are
// kept: the guide uses some of them too). Each entry was added for a measured
// miss in guide-paraphrases.ts, and points at wording the guide really uses;
// keep it that way rather than growing it by guesswork.
const PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\blog(?:ged|ging)?[ -]?(?:in|on)\b|\blogins?\b|\blogons?\b|\bsignin\b/g, "sign in address"],
  [/\bclass teachers?\b/g, "form teacher"],
  [/\broll[ -]?calls?\b/g, "register"],
  [/\bscratch[ -]?cards?\b/g, "result pin card"],
  [/\b(?:report|result) sheets?\b/g, "report card"],
  [/\b(?:second|third|next|new) term\b/g, "new term set current"],
  [/\b(?:next|new) (?:session|academic year|school year)\b/g, "new session academic year"],
  [/\b(?:2fa|otp|two[ -]?factor)\b/g, "two-factor sign-in"],
  [/\b(?:move|transfer|switch|change)\b[^.?]*\b(?:class|classes|arm)\b/g, "enroll class arm enrollments"],
];

const WORDS: Readonly<Record<string, string>> = {
  pupil: "student",
  kid: "child",
  learner: "student",
  debtor: "unpaid",
  owing: "unpaid",
  owe: "unpaid",
  arrear: "unpaid",
  outstanding: "unpaid",
  salary: "payroll",
  salari: "payroll",
  wage: "payroll",
  tuition: "fee",
  excel: "csv",
  spreadsheet: "csv",
  url: "address",
  subdomain: "address",
  atm: "card",
  attendance: "register",
  mark: "score",
};

/** The question's own terms, plus the guide's words for the ones it says differently. */
export function queryTerms(query: string): string[] {
  let text = query.toLowerCase();
  for (const [pattern, guideWords] of PHRASES) {
    if (pattern.test(text)) text += ` ${guideWords}`;
    pattern.lastIndex = 0;
  }
  const terms = tokenize(text);
  for (const t of [...terms]) {
    const guideWord = WORDS[t];
    if (guideWord) terms.push(...tokenize(guideWord));
  }
  return [...new Set(terms)];
}

/** Lowercase words, a light plural/verb-ending trim, stopwords out. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().normalize("NFKD").split(/[^a-z0-9]+/)) {
    if (raw.length === 0 || STOPWORDS.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 3 && w.endsWith("es") && /(sh|ch|x|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  return w;
}

interface Doc {
  readonly section: GuideSection;
  readonly titleTerms: ReadonlySet<string>;
  readonly tf: Map<string, number>;
  readonly length: number;
}

function buildDocs(sections: readonly GuideSection[]): { docs: Doc[]; df: Map<string, number>; avgLength: number } {
  const docs: Doc[] = [];
  const df = new Map<string, number>();
  for (const section of sections) {
    if (!section.searchable) continue;
    const titleTerms = tokenize(section.title);
    const terms = [...Array<string[]>(TITLE_WEIGHT).fill(titleTerms).flat(), ...tokenize(section.text)];
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    docs.push({ section, titleTerms: new Set(titleTerms), tf, length: terms.length });
  }
  const avgLength = docs.reduce((n, d) => n + d.length, 0) / Math.max(docs.length, 1);
  return { docs, df, avgLength };
}

let cached: ReturnType<typeof buildDocs> | undefined;

/** Top sections of the guide for a question, best first. An empty or stopword-only query finds nothing. */
export function searchGuide(
  query: string,
  options: GuideSearchOptions = {},
  sections: readonly GuideSection[] = GUIDE_SECTIONS,
): GuideHit[] {
  const index = sections === GUIDE_SECTIONS ? (cached ??= buildDocs(sections)) : buildDocs(sections);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 3), 1), MAX_LIMIT);
  const maxExcerpt = Math.max(options.maxExcerptChars ?? 1_200, 100);
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  const n = index.docs.length;
  const scored: Array<{ doc: Doc; score: number }> = [];
  for (const doc of index.docs) {
    let score = 0;
    for (const t of terms) {
      const f = doc.tf.get(t);
      if (!f) continue;
      const df = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.length) / index.avgLength));
    }
    if (score > 0) {
      const inTitle = terms.filter((t) => doc.titleTerms.has(t)).length;
      score += (TITLE_MATCH_BONUS * inTitle) / terms.length;
      scored.push({ doc, score });
    }
  }
  // Ties keep document order, so results are stable.
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ doc, score }) => {
    const s = doc.section;
    const text = s.text.length > maxExcerpt ? `${s.text.slice(0, maxExcerpt).trimEnd()}…` : s.text;
    return {
      anchor: s.anchor,
      title: s.title,
      path: [...s.parents, s.title].join(" › "),
      excerpt: text,
      score: Math.round(score * 1000) / 1000,
    };
  });
}

/** Every anchor in the guide, for checking a citation before it is shown. */
export function isGuideAnchor(anchor: string): boolean {
  return GUIDE_SECTIONS.some((s) => s.anchor === anchor);
}
