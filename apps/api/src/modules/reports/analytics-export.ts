import type {
  AcademicReportDto,
  AttendanceReportDto,
  ChronicAbsenceRowDto,
  ClassAttendanceTrendDto,
  ClassAverageRowDto,
  EnrolmentLevelRowDto,
  EnrolmentMoverDto,
  EnrolmentReportDto,
  MissingRegisterRowDto,
  RankedStudentDto,
  TeacherTrendReportDto,
  TeacherTrendRowDto,
} from "@school-kit/types";

import type { AnyExportTable, ExportColumn, ExportTable } from "../../common/export/tabular-export.js";

// Phase 9 / CP1.2 — the analytics tabs as export tables (docs/modules/phase-9.md §8.3).
// One Excel workbook (a sheet per table) or one PDF (a section per table) per
// tab. Pure: it reads the same DTO the page shows, so the file always says
// what the screen says. Hundredths become numbers with two decimals here and
// nowhere else in the file.

const h = (v: number | null): number | null => (v === null ? null : v / 100);
const pct: Pick<ExportColumn<unknown>, "numeric" | "decimals"> = { numeric: true, decimals: 2 };

/** "2026-03-02" → "w/c 2 Mar". */
export function weekLabel(iso: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = iso.split("-");
  return `w/c ${Number(d)} ${months[Number(m) - 1]}`;
}

export function academicTables(r: AcademicReportDto): AnyExportTable[] {
  const subjectName = new Map(r.subjects.map((s) => [s.subjectId, s.subjectName]));
  const classLabel = new Map(r.classes.map((c) => [c.groupId, c.label]));

  const classes: ExportTable<ClassAverageRowDto> = {
    title: "Class averages",
    note: "Counts released report cards only.",
    columns: [
      { header: "Class", value: (c) => c.label },
      { header: "Level", value: (c) => c.classLevelName },
      { header: "Students counted", value: (c) => c.releasedCount, numeric: true },
      { header: "Average %", value: (c) => h(c.averageHundredths), ...pct },
      { header: "Previous term %", value: (c) => h(c.previousAverageHundredths), ...pct },
      { header: "Change", value: (c) => h(c.changeHundredths), ...pct },
    ],
    rows: r.classes,
  };

  const cells: ExportTable<AcademicReportDto["cells"][number]> = {
    title: "Subject averages",
    columns: [
      { header: "Class", value: (c) => classLabel.get(c.groupId) ?? "" },
      { header: "Subject", value: (c) => subjectName.get(c.subjectId) ?? "" },
      { header: "Students", value: (c) => c.studentCount, numeric: true },
      { header: "Average %", value: (c) => h(c.averageHundredths), ...pct },
    ],
    rows: [...r.cells].sort(
      (a, b) =>
        r.classes.findIndex((c) => c.groupId === a.groupId) - r.classes.findIndex((c) => c.groupId === b.groupId) ||
        (subjectName.get(a.subjectId) ?? "").localeCompare(subjectName.get(b.subjectId) ?? ""),
    ),
  };

  type RankRow = RankedStudentDto & { classLabel: string; group: string; place: number };
  const rankRows: RankRow[] = r.rankings.flatMap((k) => [
    ...k.top.map((s, i) => ({ ...s, classLabel: k.label, group: "Top", place: i + 1 })),
    ...k.bottom.map((s, i) => ({ ...s, classLabel: k.label, group: "Bottom", place: i + 1 })),
  ]);
  const ranking: ExportTable<RankRow> = {
    title: "Top and bottom students",
    note: "Bottom 1 is the lowest average in the class.",
    columns: [
      { header: "Class", value: (s) => s.classLabel },
      { header: "List", value: (s) => s.group },
      { header: "Place", value: (s) => s.place, numeric: true },
      { header: "Student", value: (s) => s.name },
      { header: "Admission no.", value: (s) => s.admissionNumber },
      { header: "Average %", value: (s) => h(s.averageHundredths), ...pct },
    ],
    rows: rankRows,
  };

  return [classes, cells, ranking];
}

export function attendanceTables(r: AttendanceReportDto): AnyExportTable[] {
  const weekly: ExportTable<ClassAttendanceTrendDto> = {
    title: "Weekly attendance",
    note: "Present or late ÷ records marked, per class per week.",
    columns: [
      { header: "Class", value: (c) => c.label },
      { header: "Level", value: (c) => c.classLevelName },
      ...r.weeks.map((wk, i): ExportColumn<ClassAttendanceTrendDto> => ({
        header: `${weekLabel(wk)} %`,
        value: (c) => h(c.weeks[i]?.rateHundredths ?? null),
        ...pct,
      })),
      { header: "Term %", value: (c) => h(c.termRateHundredths), ...pct },
    ],
    rows: r.classes,
  };
  const chronic: ExportTable<ChronicAbsenceRowDto> = {
    title: "Chronic absence",
    note: `Students attending less than ${r.thresholdPercent}% of marked days.`,
    columns: [
      { header: "Student", value: (s) => s.name },
      { header: "Admission no.", value: (s) => s.admissionNumber },
      { header: "Class", value: (s) => s.classLabel },
      { header: "Days marked", value: (s) => s.daysMarked, numeric: true },
      { header: "Days absent", value: (s) => s.daysAbsent, numeric: true },
      { header: "Attendance %", value: (s) => h(s.rateHundredths), ...pct },
    ],
    rows: r.chronicAbsence,
  };
  const missing: ExportTable<MissingRegisterRowDto> = {
    title: "Days with no register",
    columns: [
      { header: "Class", value: (m) => m.label },
      { header: "School days missed", value: (m) => m.dates.length, numeric: true },
      { header: "Dates", value: (m) => m.dates.join(", ") },
    ],
    rows: r.missingRegisters,
  };
  return [weekly, chronic, missing];
}

export function enrolmentTables(r: EnrolmentReportDto): AnyExportTable[] {
  const levels: ExportTable<EnrolmentLevelRowDto> = {
    title: "Students per level",
    columns: [
      { header: "Level", value: (l) => l.label },
      { header: "This term", value: (l) => l.thisTerm, numeric: true },
      { header: "Previous term", value: (l) => l.previousTerm, numeric: true },
      { header: "Change", value: (l) => (l.previousTerm === null ? null : l.thisTerm - l.previousTerm), numeric: true },
    ],
    rows: r.levels,
  };
  const movers = (title: string, rows: EnrolmentMoverDto[]): ExportTable<EnrolmentMoverDto> => ({
    title,
    columns: [
      { header: "Student", value: (m) => m.name },
      { header: "Admission no.", value: (m) => m.admissionNumber },
      { header: "Class", value: (m) => m.classLabel },
      { header: "Reason", value: (m) => m.reason },
    ],
    rows,
  });
  return [levels, movers("Joiners", r.joiners), movers("Leavers", r.leavers)];
}

export function teacherTrendTables(r: TeacherTrendReportDto): AnyExportTable[] {
  const of = (a: number, b: number) => `${a} of ${b}`;
  const trend: ExportTable<TeacherTrendRowDto> = {
    title: "Teacher recording trend",
    note: "What each teacher recorded, term by term. It says nothing about their pupils' marks.",
    columns: [
      { header: "Teacher", value: (t) => t.name },
      ...r.terms.flatMap((term, i): Array<ExportColumn<TeacherTrendRowDto>> => [
        {
          header: `${term.name} ${term.academicYearLabel}: form registers`,
          value: (t) => {
            const c = t.terms[i];
            return c && c.formRegistersExpected > 0 ? of(c.formRegistersTaken, c.formRegistersExpected) : "—";
          },
        },
        {
          header: `${term.name} ${term.academicYearLabel}: scores`,
          value: (t) => {
            const c = t.terms[i];
            return c && c.scoresExpected > 0 ? of(c.scoresEntered, c.scoresExpected) : "—";
          },
        },
      ]),
    ],
    rows: r.rows,
  };
  return [trend];
}
