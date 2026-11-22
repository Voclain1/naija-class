import { withTenant } from "@school-kit/db";

import { nameParts, type PersonRefs } from "./question-check.js";

// ---------------------------------------------------------------------------
// The provider egress guard (2026-11-22, docs/modules/assistant-ai-governance.md,
// "Data minimisation").
//
// The per-school detectors in question-check.ts look at PATTERNS (a phone
// shape, a capitalised roster word). This guard looks for the school's ACTUAL
// VALUES: every student's, guardian's and staff member's full name as a word
// sequence (in any case, either order), every admission number, email address
// and phone number on file. It runs at the last point before a provider:
//
//   * on each message the staff member sent: a full name found here becomes an
//     opaque ⟨P#⟩ marker (resolved on the server, like the roster markers);
//     any other identifier blocks the turn;
//   * on every tool result before the model reads it: identifiers are replaced
//     by ⟨withheld⟩ (tools return labels and counts, but labels are typed by
//     schools: "Mrs Okafor's class" must not carry a staff name out);
//   * on the whole outgoing history and on text sent for speech.
//
// Exact matching cannot catch a misspelling, a nickname or a description;
// the roster detector's one-edit rule and the standing notice remain. What
// this adds is that a value SchoolKit actually holds cannot leave by a route
// the patterns did not anticipate.
// ---------------------------------------------------------------------------

export type EgressCategory = "known-name" | "known-admission-number" | "known-email" | "known-phone";

export const WITHHELD = "⟨withheld⟩";

interface Person {
  first: string | null;
  middle?: string | null;
  last: string | null;
}

export interface KnownIdentifierSource {
  people: Person[];
  admissionNumbers: string[];
  emails: string[];
  phones: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const digits = (s: string) => s.replace(/\D/g, "");
/** The national-number tail of a phone: last 10 digits ("08031234567" and "+2348031234567" agree). */
const phoneTail = (d: string) => d.slice(-10);

export class ProviderEgressGuard {
  private readonly nameRe: RegExp | null;
  private readonly admissionRe: RegExp | null;
  private readonly emails: string[];
  private readonly phoneTails: Set<string>;

  constructor(source: KnownIdentifierSource) {
    const seqs = new Set<string>();
    for (const p of source.people) {
      const f = nameParts(p.first);
      const m = nameParts(p.middle);
      const l = nameParts(p.last);
      const add = (...parts: string[][]) => {
        const toks = parts.flat();
        if (toks.length >= 2) seqs.add(toks.map(escape).join("[\\s'’.-]+"));
      };
      if (f.length && l.length) {
        add(f, l);
        add(l, f);
        if (m.length) {
          add(f, m, l);
          add(f, m);
          add(m, l);
        }
      } else {
        // A single field holding several words ("Ada Obi") still forms a sequence.
        add(f.length ? f : l);
      }
    }
    // Longest first, so "Ada Ngozi Obi" wins over "Ada Ngozi".
    const names = [...seqs].sort((a, b) => b.length - a.length);
    this.nameRe = names.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.join("|")})(?:['’]s)?(?![\\p{L}\\p{N}])`, "giu") : null;

    const adm = [...new Set(source.admissionNumbers.map((a) => a.trim()).filter((a) => a.length >= 3 && (/\D/.test(a) || a.length >= 4)))];
    adm.sort((a, b) => b.length - a.length);
    this.admissionRe = adm.length ? new RegExp(`(?<![\\p{L}\\p{N}/-])(?:${adm.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu") : null;
    this.emails = [...new Set(source.emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
    this.phoneTails = new Set(source.phones.map(digits).filter((d) => d.length >= 10).map(phoneTail));
  }

  /** Every category of known identifier present in `text`. Never the matched text. */
  scan(text: string): EgressCategory[] {
    const found = new Set<EgressCategory>();
    // Folded (accents removed): "Adáeze Okafor" is still Adaeze Okafor. markNames
    // and redact work on the text as written, so an accented spelling they
    // cannot rewrite is still FOUND here, and the caller blocks instead.
    if (this.nameRe && new RegExp(this.nameRe.source, "iu").test(fold(text))) found.add("known-name");
    if (this.admissionRe && new RegExp(this.admissionRe.source, "iu").test(text)) found.add("known-admission-number");
    const lower = text.toLowerCase();
    if (this.emails.some((e) => lower.includes(e))) found.add("known-email");
    if (this.phoneRuns(text).some((r) => this.phoneTails.has(phoneTail(r.digits)))) found.add("known-phone");
    return [...found].sort();
  }

  /** Full names become ⟨P#⟩ markers through `refs` (the server resolves them); returns the new text. */
  markNames(text: string, refs: PersonRefs): string {
    if (!this.nameRe) return text;
    return text.replace(new RegExp(this.nameRe.source, "giu"), (m) => `⟨${refs.ref(m)}⟩`);
  }

  /** Every known identifier replaced by ⟨withheld⟩. For tool results, outgoing history and speech. */
  redact(text: string): { text: string; withheld: number } {
    let withheld = 0;
    let out = text;
    if (this.nameRe) out = out.replace(new RegExp(this.nameRe.source, "giu"), () => (withheld++, WITHHELD));
    if (this.admissionRe) out = out.replace(new RegExp(this.admissionRe.source, "giu"), () => (withheld++, WITHHELD));
    for (const e of this.emails) {
      out = out.replace(new RegExp(escape(e), "gi"), () => (withheld++, WITHHELD));
    }
    if (this.phoneTails.size) {
      for (const r of this.phoneRuns(out).reverse()) {
        if (this.phoneTails.has(phoneTail(r.digits))) {
          out = out.slice(0, r.start) + WITHHELD + out.slice(r.end);
          withheld++;
        }
      }
    }
    return { text: out, withheld };
  }

  private phoneRuns(text: string): { start: number; end: number; digits: string }[] {
    const runs: { start: number; end: number; digits: string }[] = [];
    for (const m of text.matchAll(/\+?\d[\d\s().-]{7,}\d/g)) {
      const d = digits(m[0]);
      if (d.length >= 10) runs.push({ start: m.index!, end: m.index! + m[0].length, digits: d });
    }
    return runs;
  }
}

/** The school's identifiers, read under the school's own tenant for this request only. Never logged or kept. */
export async function loadProviderEgressGuard(schoolId: string): Promise<ProviderEgressGuard> {
  const source = await withTenant(schoolId, async (db) => {
    const [students, guardians, staff] = await Promise.all([
      db.student.findMany({ select: { firstName: true, middleName: true, lastName: true, admissionNumber: true, email: true, phone: true } }),
      db.guardian.findMany({ select: { firstName: true, lastName: true, email: true, phone: true } }),
      db.user.findMany({ select: { firstName: true, lastName: true, email: true, phone: true } }),
    ]);
    const s: KnownIdentifierSource = { people: [], admissionNumbers: [], emails: [], phones: [] };
    for (const st of students) {
      s.people.push({ first: st.firstName, middle: st.middleName, last: st.lastName });
      s.admissionNumbers.push(st.admissionNumber);
      if (st.email) s.emails.push(st.email);
      if (st.phone) s.phones.push(st.phone);
    }
    for (const g of guardians) {
      s.people.push({ first: g.firstName, last: g.lastName });
      if (g.email) s.emails.push(g.email);
      s.phones.push(g.phone);
    }
    for (const u of staff) {
      s.people.push({ first: u.firstName, last: u.lastName });
      if (u.email) s.emails.push(u.email);
      if (u.phone) s.phones.push(u.phone);
    }
    return s;
  }, { label: "provider-egress-guard" });
  return new ProviderEgressGuard(source);
}
