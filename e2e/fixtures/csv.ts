// CSV fixture builder for the student-import E2E (slice 13, acceptance #6).
//
// Produces the acceptance-bar shape: 250 rows, 242 good / 8 bad, where the 8
// failures span the three documented kinds — missing DOB, invalid gender code,
// and duplicate admission number (in-file dedup keeps the first occurrence and
// flags the later one — see validate-students.engine.ts).
//
// Headers are chosen so the mapping wizard's synonym guesser auto-maps all
// five required fields (Admission No → admissionNumber, etc.), and the file is
// emitted with a UTF-8 BOM + CRLF line endings to mimic a real Excel export
// (CLAUDE.md: use real-Excel-shaped fixtures; the parser runs with bom:true).

export interface StudentsCsvFixture {
  buffer: Buffer;
  good: number;
  bad: number;
  total: number;
}

// U+FEFF — the byte-order mark Excel prepends to UTF-8 CSV exports.
const UTF8_BOM = String.fromCharCode(0xfeff);

// `token` namespaces every admission number so re-runs (and concurrent runs)
// never collide on the shared dev DB — external dedup is per-tenant, but a
// unique token makes the fixture robust regardless of leftover roster state.
export function buildStudentsImportCsv(token = "x"): StudentsCsvFixture {
  const header = ["Admission No", "First Name", "Last Name", "Date of Birth", "Gender"];
  const lines: string[] = [header.join(",")];
  const goodAdmissions: string[] = [];

  // 242 good rows — unique admission numbers, valid DOB (DD/MM/YYYY) + gender.
  for (let i = 1; i <= 242; i++) {
    const adm = `ADM-${token}-${String(i).padStart(4, "0")}`;
    goodAdmissions.push(adm);
    lines.push([adm, `First${i}`, `Last${i}`, "15/09/2012", i % 2 ? "Male" : "Female"].join(","));
  }

  // 3 bad — missing date of birth.
  for (let i = 1; i <= 3; i++) {
    lines.push([`BAD-DOB-${token}-${i}`, `NoDob${i}`, "Pupil", "", "Male"].join(","));
  }

  // 3 bad — invalid gender code.
  for (let i = 1; i <= 3; i++) {
    lines.push([`BAD-GEN-${token}-${i}`, `BadGen${i}`, "Pupil", "15/09/2012", "X"].join(","));
  }

  // 2 bad — duplicate admission number (reuse two good rows; the later
  // occurrence is the one flagged bad).
  lines.push([goodAdmissions[0], "DupA", "Pupil", "15/09/2012", "Male"].join(","));
  lines.push([goodAdmissions[1], "DupB", "Pupil", "15/09/2012", "Female"].join(","));

  const csv = UTF8_BOM + lines.join("\r\n") + "\r\n";
  return { buffer: Buffer.from(csv, "utf8"), good: 242, bad: 8, total: 250 };
}
