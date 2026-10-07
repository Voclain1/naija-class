// Offline checks on the register-scan scorer (../register-scans/score.ts).
//
// The live accuracy pass decides whether Smart Student Import can be switched
// on, so the arithmetic behind its yes/no must be right before any real page
// is scored. Synthetic rows only — invented names, no real child's data.

import {
  alignRows,
  scoreField,
  scorePage,
  verdicts,
  type ExtractedRow,
  type TruthRow,
} from "../register-scans/score.js";
import { check, type CheckResult, type EvalCase } from "../harness.js";

function truth(admissionNumber: string, firstName: string, lastName: string, extra: Partial<TruthRow> = {}): TruthRow {
  return {
    admissionNumber,
    firstName,
    middleName: null,
    lastName,
    dateOfBirth: null,
    gender: "FEMALE",
    classArm: "JSS 1A",
    guardianName: null,
    guardianPhone: "08031234567",
    ...extra,
  };
}

function read(row: TruthRow, extra: Partial<ExtractedRow> = {}): ExtractedRow {
  const { illegible: _illegible, ...fields } = row;
  return { ...fields, unreadableFields: [], ...extra };
}

const PAGE: TruthRow[] = [
  truth("A/001", "Adaeze", "Okafor"),
  truth("A/002", "Chukwuemeka", "Nwosu"),
  truth("A/003", "Oluwaseun", "Adeyemi"),
  truth("A/004", "Yetunde", "Bello"),
];

export const registerScanScoringCase: EvalCase = {
  suite: "Register-scan scoring (student-list-extraction accuracy pass)",
  run(): CheckResult[] {
    const r = PAGE[1]!;
    const perfect = scorePage(PAGE, PAGE.map((row) => read(row)));
    // The model skipped row 2: index pairing would score rows 3 and 4 against
    // their neighbours; alignment must pair them with themselves.
    const skipped = scorePage(PAGE, [PAGE[0]!, PAGE[2]!, PAGE[3]!].map((row) => read(row)));
    const smudged = truth("A/005", "Ngozi", "Eze", { admissionNumber: "A/0?5", illegible: ["admissionNumber"] });

    return [
      check(
        "a perfect read scores every cell correct and passes the bar",
        perfect.droppedRows === 0 &&
          perfect.extraRows === 0 &&
          Object.values(perfect.fields).every((t) => t.wrong + t.invented + t.missed + t.flagged === 0) &&
          verdicts(perfect).every((v) => v.passed),
      ),
      check(
        "a 'corrected' Nigerian name is a silent error, not a near miss",
        scoreField("firstName", r, read(r, { firstName: "Chukwueka" })) === "wrong",
      ),
      check(
        "case and hyphens count: transcription is exact",
        scoreField("lastName", r, read(r, { lastName: "nwosu" })) === "wrong" &&
          scoreField("lastName", { ...r, lastName: "Okafor-Nwosu" }, read(r, { lastName: "Okafor Nwosu" })) ===
            "wrong",
      ),
      check(
        "extra whitespace is not an error",
        scoreField("firstName", r, read(r, { firstName: "  Chukwuemeka " })) === "correct",
      ),
      check(
        "null plus a flag is a safe miss; null without one is a miss; a value on a blank is invented",
        scoreField("guardianPhone", r, read(r, { guardianPhone: null, unreadableFields: ["guardianPhone"] })) ===
          "flagged" &&
          scoreField("guardianPhone", r, read(r, { guardianPhone: null })) === "missed" &&
          scoreField("guardianName", r, read(r, { guardianName: "Mrs Nwosu" })) === "invented",
      ),
      check(
        "a field the checker could not read is right only as null plus a flag",
        scoreField("admissionNumber", smudged, read(smudged, { admissionNumber: null, unreadableFields: ["admissionNumber"] })) ===
          "correct" && scoreField("admissionNumber", smudged, read(smudged, { admissionNumber: "A/005" })) === "invented",
      ),
      check(
        "a skipped row is counted as dropped and the rows after it still pair with themselves",
        skipped.droppedRows === 1 &&
          skipped.extraRows === 0 &&
          skipped.fields.firstName.correct === 3 &&
          skipped.fields.firstName.wrong === 0,
      ),
      check(
        "rows still pair when a name is misread",
        JSON.stringify(alignRows(PAGE, PAGE.map((row, i) => read(row, i === 2 ? { firstName: "Oluwasen" } : {})))) ===
          JSON.stringify([
            [0, 0],
            [1, 1],
            [2, 2],
            [3, 3],
          ]),
      ),
      check(
        "one invented admission number fails the bar on its own",
        !verdicts(scorePage(PAGE, PAGE.map((row, i) => read(row, i === 0 ? { admissionNumber: "A/009" } : {}))))[0]!
          .passed,
      ),
    ];
  },
};
