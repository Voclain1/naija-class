import { withTenant } from "@school-kit/db";

// ---------------------------------------------------------------------------
// G-PII: the check a help-assistant question passes before it reaches the
// model, storage or a log (docs/reviews/agentic-implementation-plan.md §3.6;
// owner's decision 2026-11-08, D1/D2 in docs/reviews/agentic-f16-f17-approval-brief.md).
//
// Deterministic, no model call. A question that trips any detector is refused
// with the CATEGORIES found, never the matched text. A question that passes is
// still treated as possibly containing personal data: these detectors have
// known false negatives (nicknames, descriptions, other schools' children,
// addresses; listed in §3.6), and nothing may call a passed question
// "checked", "clean" or "PII-free". CLAUDE.md's third allowlist row is what
// accepts that residual.
//
// Every earlier turn the browser resends is checked again, every time.
// ---------------------------------------------------------------------------

export type QuestionCheckCategory =
  | "roster-name" //       a name of someone at this school
  | "admission-number" //  one of this school's admission numbers
  | "email"
  | "phone"
  | "long-number" //       10–11 digits: BVN, NIN, account numbers
  | "full-date" //         a day, month and year: a possible date of birth
  | "too-long" //          over MAX_QUESTION_CHARS
  | "pasted-rows"; //      tab- or comma-separated lines: a paste

export interface QuestionCheckResult {
  readonly blocked: boolean;
  /** Sorted, unique. Never the matched text. */
  readonly categories: readonly QuestionCheckCategory[];
}

/** The school's own people, as the detectors need them: lowercase name parts and admission numbers. */
export interface QuestionRoster {
  readonly nameParts: ReadonlySet<string>;
  readonly admissionNumbers: ReadonlySet<string>;
}

export const MAX_QUESTION_CHARS = 1_000;

// Names that are also ordinary English words (many Nigerian given names are).
// Such a name blocks only when it is written capitalised and not as the first
// word of a sentence: "Grace in JSS 2 can't sign in" is blocked, "is there a
// grace period for fees" is not. The decision is the plan's (§3.6 tests,
// "tested both ways"); each word here is one such case.
const COMMON_WORD_NAMES = new Set(
  (
    "grace faith joy hope mercy peace favour favor blessing blessings gift precious glory praise victory wisdom " +
    "goodness patience comfort charity divine miracle love success treasure destiny honour honor justice " +
    "light star rose may june april august summer sunday monday friday will mark bill rich king prince " +
    "princess lord bishop deacon pastor chief rich hand hands bank page wood field hill brown green white black " +
    "young long short lucky happy smart sweet gold silver ruby pearl jewel crystal dawn hilary christian"
  ).split(" "),
);

// Words a staff member uses about SchoolKit that are also surnames or given
// names somewhere ("Class", "Term", "Grade"). Never blocked, in any case.
const PRODUCT_WORDS = new Set(
  (
    "class classes term terms session sessions grade grades grading score scores fee fees invoice invoices " +
    "student students pupil pupils parent parents guardian guardians teacher teachers staff school schools " +
    "report reports result results register attendance subject subjects exam exams test tests admin owner " +
    "bursar principal head form arm arms level levels primary junior senior secondary nursery jss sss kg " +
    "payment payments paystack receipt receipts portal password email phone settings setting dashboard " +
    "calendar timetable homework library hostel transport store payroll salary salaries account accounts " +
    "message messages announcement announcements notification notifications website address code pin pins " +
    "card cards promote promotion enrol enroll enrolment enrollment first second third new next last"
  ).split(" "),
);

const STOPWORDS = new Set(
  (
    "a an and are as at be but by can do does for from how i if in into is it its me my of on or our so that the " +
    "their them then there these they this to us was we what when where which who why will with you your not no"
  ).split(" "),
);

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Name parts of a full name: "Ade-Ola  Okonkwo" → ["ade", "ola", "okonkwo"]. */
export function nameParts(...names: Array<string | null | undefined>): string[] {
  return names
    .flatMap((n) => fold(n ?? "").split(/[^a-z'\u2019]+/))
    .map((p) => p.replace(/['\u2019]/g, ""))
    .filter((p) => p.length >= 2);
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?234|0)[789][01]\d{8}(?!\d)/;
const LONG_NUMBER = /(?<!\d)\d{10,11}(?!\d)/;
const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const FULL_DATE = [
  /(?<!\d)\d{1,2}[/.-]\d{1,2}[/.-](?:19|20)\d{2}(?!\d)/, // 05/03/2014
  /(?<!\d)(?:19|20)\d{2}-\d{1,2}-\d{1,2}(?!\d)/, // 2014-03-05
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?(?:\\s+of)?\\s+(?:${MONTHS})\\.?,?\\s+(?:19|20)\\d{2}\\b`, "i"), // 5th of March 2014
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:19|20)\\d{2}\\b`, "i"), // March 5, 2014
];

/** The pure check: no I/O. */
export function checkQuestion(text: string, roster: QuestionRoster): QuestionCheckResult {
  const found = new Set<QuestionCheckCategory>();

  if (text.length > MAX_QUESTION_CHARS) found.add("too-long");
  const rowLines = text.split(/\r?\n/).filter((l) => l.includes("\t") || (l.match(/,/g)?.length ?? 0) >= 2);
  if (rowLines.length >= 2) found.add("pasted-rows");

  if (EMAIL.test(text)) found.add("email");
  // Numbers: separators between digits removed first, so "0803 123 4567" and
  // "+234-803-…" are caught.
  const compact = text.replace(/(?<=\d)[\s.-]+(?=\d)/g, "");
  if (PHONE.test(compact)) found.add("phone");
  else if (LONG_NUMBER.test(compact)) found.add("long-number");
  if (FULL_DATE.some((re) => re.test(text))) found.add("full-date");

  if (rosterNameSpans(text, roster).length > 0) found.add("roster-name");

  for (const token of text.split(/[\s,;()]+/)) {
    const t = fold(token).replace(/[.?!]+$/, "");
    if ((t.length >= 4 || /\D/.test(t)) && roster.admissionNumbers.has(t)) {
      found.add("admission-number");
      break;
    }
  }

  const categories = [...found].sort();
  return { blocked: categories.length > 0, categories };
}

/**
 * The words in `text` that match a name on the school's roster, by the SAME
 * rules the "roster-name" detector uses (case, sentence start, common-word
 * names, one-edit misspellings). Positions are character offsets.
 */
export function rosterNameSpans(text: string, roster: QuestionRoster): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  // Words, with their position so a capitalised word at a sentence start is known.
  for (const m of text.matchAll(/[\p{L}][\p{L}'\u2019-]*/gu)) {
    const before = text.slice(0, m.index).trimEnd();
    const w = { raw: m[0], sentenceStart: before === "" || /[.!?:\n]$/.test(before) };
    // Possessive off first ("Ada's" → "ada"), then any other apostrophe.
    const t = fold(w.raw).replace(/['\u2019]s$/, "").replace(/['\u2019]/g, "");
    let hit = false;
    for (const part of t.split("-")) {
      if (part.length < 2 || STOPWORDS.has(part) || PRODUCT_WORDS.has(part)) continue;
      const capitalised = /^\p{Lu}/u.test(w.raw);
      if (roster.nameParts.has(part)) {
        if (!COMMON_WORD_NAMES.has(part) || (capitalised && !w.sentenceStart)) hit = true;
        continue;
      }
      // One-edit matches ("Chimaka" for Chiamaka) only for a capitalised word
      // mid-sentence: lowercase, they would catch ordinary words ("hello" for a
      // pupil called Bello). A lowercase misspelling is a known miss (§3.6).
      if (capitalised && !w.sentenceStart && part.length >= 5 && !COMMON_WORD_NAMES.has(part)) {
        for (const name of roster.nameParts) {
          if (name.length >= 5 && !COMMON_WORD_NAMES.has(name) && withinOneEdit(part, name)) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) spans.push({ start: m.index!, end: m.index! + m[0].length });
  }
  return spans;
}

/**
 * Names on the roster, replaced by opaque markers before any text reaches the
 * model (SchoolKit Assistant, docs/modules/assistant-workspace.md, "Named
 * student lookup"). Adjacent name words ("Samuel Okoro") are one marker. The
 * same name gets the same marker across every message of a turn, through
 * `refs`, which the server keeps for that request only and uses to resolve the
 * person; the model only ever sees "⟨P1⟩". Every other detector still applies
 * to the redacted text.
 */
/** "Samuel Okoro's" → "Samuel Okoro": the possessive is grammar, not part of the name. */
export function stripPossessive(name: string): string {
  return name.replace(/['\u2019]s(?=\s|$)/gi, "").replace(/s['\u2019](?=\s|$)/gi, "s").trim();
}

export class PersonRefs {
  private readonly byKey = new Map<string, string>();
  readonly values = new Map<string, string>();
  ref(rawName: string): string {
    // "Samuel Okoro's" and "Samuel Okoro" are the same person: one marker, and
    // the name the server later looks up carries no possessive.
    const raw = stripPossessive(rawName);
    const key = fold(raw).replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
    let r = this.byKey.get(key);
    if (!r) {
      r = `P${this.byKey.size + 1}`;
      this.byKey.set(key, r);
      this.values.set(r, raw.trim());
    }
    return r;
  }
}

export function redactRosterNames(text: string, roster: QuestionRoster, refs: PersonRefs): string {
  const spans = rosterNameSpans(text, roster);
  if (spans.length === 0) return text;
  // Merge words separated only by spaces into one name.
  const merged: { start: number; end: number }[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && /^\s+$/.test(text.slice(last.end, s.start))) last.end = s.end;
    else merged.push({ ...s });
  }
  let out = "";
  let at = 0;
  for (const s of merged) {
    out += text.slice(at, s.start) + `⟨${refs.ref(text.slice(s.start, s.end))}⟩`;
    at = s.end;
  }
  return out + text.slice(at);
}

/** The school's students, guardians and staff, read under the school's own tenant. */
export async function loadQuestionRoster(schoolId: string): Promise<QuestionRoster> {
  return withTenant(schoolId, async (db) => {
    const [students, guardians, staff] = await Promise.all([
      db.student.findMany({ select: { firstName: true, middleName: true, lastName: true, admissionNumber: true } }),
      db.guardian.findMany({ select: { firstName: true, lastName: true } }),
      db.user.findMany({ select: { firstName: true, lastName: true } }),
    ]);
    const parts = new Set<string>();
    for (const s of students) for (const p of nameParts(s.firstName, s.middleName, s.lastName)) parts.add(p);
    for (const g of guardians) for (const p of nameParts(g.firstName, g.lastName)) parts.add(p);
    for (const u of staff) for (const p of nameParts(u.firstName, u.lastName)) parts.add(p);
    // A name part that is also a product word is never matched (PRODUCT_WORDS); drop it here too.
    for (const p of [...parts]) if (PRODUCT_WORDS.has(p) || STOPWORDS.has(p)) parts.delete(p);
    return {
      nameParts: parts,
      admissionNumbers: new Set(students.map((s) => fold(s.admissionNumber.trim())).filter((a) => a.length > 0)),
    };
  });
}

/** Every message of a conversation, the new question and each earlier one, checked together. */
export function checkConversation(messages: readonly string[], roster: QuestionRoster): QuestionCheckResult {
  const all = new Set<QuestionCheckCategory>();
  for (const m of messages) for (const c of checkQuestion(m, roster).categories) all.add(c);
  const categories = [...all].sort();
  return { blocked: categories.length > 0, categories };
}
