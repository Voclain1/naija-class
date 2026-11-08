// ---------------------------------------------------------------------------
// The FD-3b conformance scan (docs/reviews/agentic-implementation-plan.md §3.3,
// §4.4): does a tool's MODEL-BOUND output carry personal data, money,
// behaviour or health?
//
// Two checks, both needed:
//   - VALUES: the output is searched for the fixture school's own planted
//     values — names, emails, phones, dates of birth, kobo amounts in the
//     forms a tool might print them, behaviour notes and category names,
//     health notes. A value can only be found if it was planted, so the gate
//     builds a fixture with every one of them present.
//   - FIELD NAMES: a behaviour field or count (P16) or a health field (R2 is
//     not decided, so none is allowed) fails on its NAME, whatever its value,
//     both in the declared outputFields and in any JSON key in the output.
//     This is what catches `behaviourCount: 3`, which no value search can.
//
// What this does NOT prove: that a tool never returns personal data of a
// school other than the fixture, or in a form not searched for here (a name
// spelled backwards, an amount split across fields). It is a gate against the
// ordinary leaks, run on every tool on every CI pass. It says nothing about
// what USERS type (§3.6).
// ---------------------------------------------------------------------------

export interface PlantedValue {
  /** What it is, for the finding: "student first name", "guardian email". */
  readonly label: string;
  readonly value: string;
}

export interface ConformanceFixture {
  /** Names, emails, admission numbers, DOB renderings: matched case-insensitively. */
  readonly personal: readonly PlantedValue[];
  /** Phone numbers: matched on their last ten digits, ignoring separators. */
  readonly phones: readonly PlantedValue[];
  /** Money, in kobo: matched as kobo, as naira with decimals, and as rounded naira. */
  readonly koboAmounts: ReadonlyArray<{ readonly label: string; readonly kobo: number }>;
  /** Behaviour notes and category names (P16). */
  readonly behaviour: readonly PlantedValue[];
  /** Health notes (R2 undecided: none may reach the model). */
  readonly health: readonly PlantedValue[];
}

/** Field names that are behaviour (P16): records, counts, categories, points, incidents, discipline. */
export const BEHAVIOUR_FIELD = /behaviou?r|disciplin|incident|demerit|merit|conduct|sanction|commendation|points/i;

/** Field names that are health. Fails the gate until R2 is decided. */
export const HEALTH_FIELD =
  /health|medical|allerg|medication|condition|blood|clinic|emergency|vaccin|teacher_?note|illness|diagnos|immunis|immuniz/i;

/** Findings for the field names a tool declares it returns. */
export function scanFieldNames(fields: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (BEHAVIOUR_FIELD.test(f)) out.push(`behaviour field "${f}"`);
    if (HEALTH_FIELD.test(f)) out.push(`health field "${f}"`);
  }
  return out;
}

/** Every JSON key in the text, read from `"key":` so a truncated output is still scanned. */
function jsonKeys(content: string): string[] {
  const keys: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) keys.push(m[1]!);
  return keys;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The forms a tool might print a kobo amount in. */
export function amountForms(kobo: number): string[] {
  const naira = Math.trunc(kobo / 100);
  const k = Math.abs(kobo % 100);
  const forms = new Set<string>([String(kobo), String(naira), String(Math.round(kobo / 100))]);
  forms.add(`${naira}.${String(k).padStart(2, "0")}`);
  if (k % 10 === 0) forms.add(`${naira}.${k / 10}`);
  return [...forms];
}

/** Findings for one model-bound output. Empty means nothing planted was found. */
export function scanToolOutput(content: string, fixture: ConformanceFixture): string[] {
  const out: string[] = [];
  const lower = content.toLowerCase();

  for (const p of fixture.personal) {
    if (p.value && lower.includes(p.value.toLowerCase())) out.push(p.label);
  }

  const digits = content.replace(/\D/g, "");
  for (const p of fixture.phones) {
    const tail = p.value.replace(/\D/g, "").slice(-10);
    if (tail.length === 10 && digits.includes(tail)) out.push(p.label);
  }

  // Amounts: separators between digits removed ("47,352.51" → "47352.51"), then
  // each form must stand alone, not inside a longer number.
  const plain = content.replace(/(\d)[,\s](?=\d{3}\b)/g, "$1");
  for (const a of fixture.koboAmounts) {
    for (const form of amountForms(a.kobo)) {
      if (new RegExp(`(?<![\\d.])${escape(form)}(?![\\d]|\\.\\d)`).test(plain)) {
        out.push(`money: ${a.label} (${form})`);
        break;
      }
    }
  }

  for (const b of fixture.behaviour) {
    if (b.value && lower.includes(b.value.toLowerCase())) out.push(`behaviour: ${b.label}`);
  }
  for (const h of fixture.health) {
    if (h.value && lower.includes(h.value.toLowerCase())) out.push(`health: ${h.label}`);
  }

  out.push(...scanFieldNames(jsonKeys(content)));
  return [...new Set(out)];
}
