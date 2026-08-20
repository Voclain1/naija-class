// Student list extraction prompt — Smart Student Import.
//
// See docs/modules/smart-student-import.md. An admin photographs a
// handwritten or printed class register; this prompt transcribes it into
// rows the existing CSV import pipeline can validate and commit.
//
// ---------------------------------------------------------------------------
// THIS IS THE ONE PROMPT IN THE PRODUCT PERMITTED TO CARRY STUDENT PII.
//
// CLAUDE.md's AI hard rules name `student-list-extraction` in the PII-bearing
// prompt allowlist, and that allowlist is exactly one row long on purpose.
// The PII here is not incidental to the feature — it IS the feature: the
// school already holds this register and already has this data; the product
// is the transcription. There is nothing to make opaque.
//
// Two rules bind this prompt's membership on that list, and both are enforced
// elsewhere rather than by convention here:
//   1. The image is never retained beyond the single request (D3) — no
//      storage object, no queue payload, no cache. Enforced by the upload
//      path holding the buffer in memory only.
//   2. Extraction never writes to a Student row without explicit human
//      confirmation (D4) — enforced by terminating in an ImportJob that the
//      admin must review and commit.
// If you are reading this because you want a SECOND PII-bearing prompt: it
// needs its own row in CLAUDE.md and its own sign-off. Do not reuse this one.
// ---------------------------------------------------------------------------
//
// MODEL: Sonnet 5, a deliberate departure from phase-5.md D7's "Haiku by
// default". D7's argument is volume asymmetry, and this feature is low
// volume (a handful of scans during onboarding) and quality-sensitive in the
// most permanent way available — a misread name becomes a child's official
// record. The decisive factor is the resolution tier: Sonnet 5 is
// high-resolution (4784 visual tokens, 2576px long edge) where Haiku 4.5 is
// standard (1568 / 1568), so a 12MP register photo reaches the model with
// roughly three times the pixel detail. On a densely ruled handwritten page
// that is the difference between reading a name and guessing at it. Same
// shape of argument D7 already accepted for lesson plans.

import { MODELS } from "../models.js";
import type { PromptDefinition } from "./registry.js";

export const STUDENT_LIST_EXTRACTION_PROMPT: PromptDefinition = {
  name: "student-list-extraction",
  version: "1",
  model: MODELS.SONNET_5,
  // Sized for a full page. A 40-name register at ~110 output tokens per row
  // (eight fields plus the unreadable-field array) is ~4,400; 6000 leaves
  // headroom for a dense page without letting a runaway generation eat the
  // school's budget. This number is also the output half of the budget
  // reservation, so an inflated value would make schools look closer to
  // their cap than they are.
  //
  // D5 caps a scan at ONE page precisely so this number can stay honest —
  // two pages would double output and there would be no single sensible
  // ceiling to reserve against.
  maxTokens: 6000,
};

// Per-row output. Every field except the three the import pipeline treats as
// required is nullable, and ALL of them are nullable here — including the
// required three — because "the model could not read the admission number"
// is a real outcome that must round-trip to the review grid as an empty,
// flagged cell. Refusing to represent it would force the model to choose
// between inventing a value and dropping the row, and it would choose one.
//
// Structured outputs restrictions this schema respects: every object carries
// additionalProperties: false and an explicit `required` list; no recursion,
// no numeric/string constraints (minLength, pattern, ...) — those are not
// supported and would fail schema compilation.
export const STUDENT_LIST_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      description:
        "One entry per student row visible on the page, in the order they appear top to bottom.",
      items: {
        type: "object",
        properties: {
          admissionNumber: {
            type: ["string", "null"],
            description:
              "The admission or registration number exactly as written. Null if the column is absent or the value is illegible. NEVER derive this from the row's position on the page.",
          },
          firstName: {
            type: ["string", "null"],
            description: "Given name, transcribed exactly as written.",
          },
          middleName: {
            type: ["string", "null"],
            description: "Middle name if present, transcribed exactly as written. Null if absent.",
          },
          lastName: {
            type: ["string", "null"],
            description: "Surname / family name, transcribed exactly as written.",
          },
          dateOfBirth: {
            type: ["string", "null"],
            description:
              "Date of birth in strict YYYY-MM-DD form. Null if absent, illegible, or if the written form is genuinely ambiguous between day-first and month-first (e.g. 03/04/2015) and the page gives no key.",
          },
          gender: {
            type: ["string", "null"],
            enum: ["MALE", "FEMALE", "OTHER", null],
            description:
              "Normalised from whatever the page uses (M/F, Male/Female, B/G for boy/girl). Null if absent or illegible.",
          },
          classArm: {
            type: ["string", "null"],
            description:
              "The class arm name as written, e.g. 'JSS 1A'. Often a page heading that applies to every row rather than a per-row column — if so, repeat it on every row. Null if the page never states it.",
          },
          guardianName: {
            type: ["string", "null"],
            description: "Parent or guardian full name as written. Null if absent.",
          },
          guardianPhone: {
            type: ["string", "null"],
            description:
              "Parent or guardian phone number, digits and any leading + preserved exactly as written. Do not reformat, do not add or remove a leading zero, do not add a country code.",
          },
          unreadableFields: {
            type: "array",
            description:
              "Names of the fields on THIS row that are present on the page but could not be read with confidence. A field you returned as null because it is genuinely absent from the page does NOT belong here — this list means 'something is written there and I could not read it', which is what tells the admin a cell needs their eyes rather than their typing.",
            items: { type: "string" },
          },
        },
        required: [
          "admissionNumber",
          "firstName",
          "middleName",
          "lastName",
          "dateOfBirth",
          "gender",
          "classArm",
          "guardianName",
          "guardianPhone",
          "unreadableFields",
        ],
        additionalProperties: false,
      },
    },
    pageNotes: {
      type: ["string", "null"],
      description:
        "One short sentence about the page as a whole if something affects the whole extraction — the photo is cut off, a column heading is unreadable, rows are obscured. Null if the page read cleanly.",
    },
  },
  required: ["rows", "pageNotes"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// The system prompt.
//
// The two rules that carry the most weight here are D6's two failure modes,
// and they are stated as prohibitions with worked examples rather than as
// preferences, because both produce output that LOOKS correct:
//
//   1. Guessing an illegible field. A plausible invented admission number is
//      indistinguishable from a real one in the review grid.
//   2. "Correcting" an unfamiliar Nigerian name toward a familiar spelling.
//      This is the sharper of the two and the one a general-purpose model is
//      most likely to do unprompted, because helpfully normalising text is
//      usually the right instinct. Here it writes a permanent error into a
//      child's record that is plausible enough to survive review.
// ---------------------------------------------------------------------------
export const STUDENT_LIST_EXTRACTION_SYSTEM = `You are transcribing a Nigerian school's student register from a photograph. The page may be handwritten, printed, or a mix. Your job is transcription, not interpretation.

TRANSCRIBE EXACTLY. Copy what is written, character for character.

Nigerian names are the point of this task and the place you are most likely to go wrong. Names such as Chukwuemeka, Adaeze, Oluwaseun, Ngozi, Ifeanyichukwu, Aisha, Chiamaka, Babatunde, Yetunde and Olamide are ordinary names, not errors to be tidied. Never adjust a spelling toward one you find more familiar or more phonetically regular. If a letter is unclear, you must NOT pick the nearest recognisable name — mark the field unreadable instead. Writing "Chukwueka" for "Chukwuemeka", or "Adaeza" for "Adaeze", puts a wrong name on a child's permanent school record, and it is wrong in a way that looks right to whoever reviews it.

The same applies to surnames, place names and guardian names. Do not standardise capitalisation, do not expand abbreviations, do not correct apparent misspellings. If the page says "Emeka Okafor-Nwosu", that is the name.

NEVER GUESS. For every field, you have three honest options: the value you can actually read, null because the page does not contain it, or null plus the field name in unreadableFields because something is written there that you cannot read with confidence. Choose the third whenever you are unsure. An empty cell the admin fills in takes them five seconds; a plausible wrong value may never be caught at all.

Specifically:
- Never invent an admission number, and never derive one from a row's position on the page or from a pattern you notice in the numbers above it. If a row's admission number is smudged, it is unreadable — even when the rows above and below make the "obvious" value clear. That inference is exactly the kind that is right nine times and silently wrong the tenth.
- Never infer a value from neighbouring rows. Each row is transcribed on its own evidence.
- Never complete a partially visible name. "Chi..." cut off at the page edge is unreadable, not "Chinedu".
- Never convert an ambiguous date. If a date is written 03/04/2015 and the page carries no indication whether it is day-first or month-first, return null and list dateOfBirth as unreadable. Nigerian schools normally write day-first, but "normally" is not good enough for a date of birth.

PHONE NUMBERS: preserve digits exactly as written, including any leading zero. Do not add a country code, do not strip a leading zero, do not insert spaces or dashes that are not there. A phone number the school cannot dial is worse than a blank one they notice.

CLASS ARM: this is very often a heading at the top of the page ("JSS 1A Register", "Primary 4 Gold") rather than a per-row column. When it is a heading, repeat it on every row. When it is genuinely absent, use null on every row — do not infer a class from the students' apparent ages.

ROWS: return one entry per student row visible on the page, top to bottom, in page order. Do not merge rows, do not split a row, do not skip a row because it is mostly unreadable — an almost entirely unreadable row should still appear, with its fields null and listed in unreadableFields, so the admin can see the page had a row there. Ignore header rows, column labels, totals, and any signature or remarks line at the foot of the page.

If the photograph is too poor to read at all, or does not appear to be a student register, return an empty rows array and say so in pageNotes.`;

export interface StudentListExtractionInput {
  // Class arms the school actually has, so the model can match a page
  // heading to a real arm name instead of inventing a formatting for it.
  // Names only — this is school structure, not student data.
  readonly knownClassArms: readonly string[];
}

// The text block, which travels AFTER the image (see AiCallRequest.images —
// Anthropic's vision docs are explicit that image-then-text reads better,
// and here the instructions are about the image, so the model should have
// seen it first).
//
// Deliberately short. The system prompt carries the rules; this carries only
// the per-call context, which keeps the cacheable prefix stable across scans.
export function renderStudentListExtractionPrompt(input: StudentListExtractionInput): string {
  const lines = ["Transcribe every student row in this register photograph."];

  if (input.knownClassArms.length > 0) {
    lines.push(
      "",
      "This school's class arms are listed below. If the page names a class, match it to one of these spellings exactly. If the page names a class that is not on this list, transcribe what the page says rather than forcing it onto the nearest entry — the admin will resolve it.",
      ...input.knownClassArms.map((arm) => `- ${arm}`),
    );
  }

  return lines.join("\n");
}
