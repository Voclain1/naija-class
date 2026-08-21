// READ-ONLY census: how many schools are stuck without a usable academic
// calendar, and which of them already have real data attached.
//
// WHY THIS EXISTS. docs/modules/academic-calendar-bootstrap.md (#198) —
// every newly provisioned school lands with no academic year and no term,
// through both onboarding paths, so it cannot enroll a student, issue an
// invoice, or mark a register. The plan-first's §5 sized the population
// against the LOCAL dev database, which is ~40% e2e/test schools and
// therefore not a census. This script produces the real one.
//
// WRITES NOTHING. No inserts, no updates, not even an audit row — it is a
// count. That is deliberate: the plan-first's §4 concluded existing schools
// must be PROMPTED, never auto-filled, because term dates are school-specific
// judgement rather than universally-correct values (unlike the 14 class
// levels backfill-school-defaults.ts writes). So there is no --apply here and
// there is nothing for one to do.
//
// SAFETY RAILS, mirroring backfill-school-defaults.ts:
//
//   1. RLS-SCOPED, NOT SUPERUSER. Connects as the ordinary runtime role
//      (DATABASE_URL / app_user) and sets app.current_school_id per school,
//      exactly like the application does. It deliberately does NOT use
//      DIRECT_URL. This matters for correctness here, not just hygiene:
//      academic_years, terms, enrollments, invoices and students are all
//      under FORCE RLS, so counting them WITHOUT a per-school GUC silently
//      returns zero for every school and the census would report the whole
//      estate as broken. (`schools` itself has no policy — it is the tenant
//      table every other policy keys off — so the outer list is readable.)
//   2. PRINTS ITS TARGET. The connected host and database are echoed at the
//      top, credentials stripped. A census whose provenance is ambiguous is
//      not evidence.
//   3. READ-ONLY BY CONSTRUCTION, not by flag.
//
// The buckets below are the plan-first's §4 predicate, split so the two
// populations stay visible separately:
//
//   PRISTINE   zero academic years AND zero enrollments AND zero invoices.
//              Nothing can have been mis-attributed because nothing exists.
//              This is the approved backfill predicate, if a backfill is ever
//              wanted — note it is NOT the student guard the earlier script
//              used, which would skip exactly the schools most in need.
//   NO_CURRENT has academic years but no is_current term. The school made
//              real choices; picking which term is "current" on its behalf is
//              a judgement call, so these are prompt-only regardless.
//   HEALTHY    has an is_current term.
//
// USAGE (from the repo root):
//   pnpm db:census-academic-calendar            # summary only
//   pnpm db:census-academic-calendar -- --list  # plus one line per stuck school
//
// Point DATABASE_URL at the target database. Against production that means
// the production app_user URL — the same one the API itself runs with.

import { Prisma, basePrisma } from "../src/index.js";

interface Counts {
  years: number;
  currentYears: number;
  terms: number;
  currentTerms: number;
  students: number;
  enrollments: number;
  invoices: number;
}

type Bucket = "PRISTINE" | "NO_YEAR_WITH_DATA" | "NO_CURRENT" | "HEALTHY";

async function inTenant<T>(
  schoolId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return basePrisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_school_id', $1, true)`, schoolId);
      return fn(tx);
    },
    { timeout: 20_000 },
  );
}

// Strips credentials so the target is identifiable but the password never
// reaches stdout or a CI log.
function describeTarget(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) return "<DATABASE_URL not set>";
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname} (user=${u.username || "<none>"})`;
  } catch {
    return "<unparseable DATABASE_URL>";
  }
}

function bucketFor(c: Counts): Bucket {
  if (c.currentTerms > 0) return "HEALTHY";
  if (c.years === 0) {
    return c.enrollments === 0 && c.invoices === 0 ? "PRISTINE" : "NO_YEAR_WITH_DATA";
  }
  return "NO_CURRENT";
}

async function main(): Promise<void> {
  const listMode = process.argv.includes("--list");

  console.log("Academic-calendar census (READ ONLY — writes nothing)");
  console.log(`Target: ${describeTarget()}`);
  console.log("");

  const schools = await basePrisma.school.findMany({
    select: { id: true, name: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const tally: Record<Bucket, number> = {
    PRISTINE: 0,
    NO_YEAR_WITH_DATA: 0,
    NO_CURRENT: 0,
    HEALTHY: 0,
  };
  const byStatus = new Map<string, number>();
  const stuck: Array<{ name: string; status: string; bucket: Bucket; c: Counts }> = [];

  for (const s of schools) {
    const c = await inTenant(s.id, async (tx) => ({
      years: await tx.academicYear.count(),
      currentYears: await tx.academicYear.count({ where: { isCurrent: true } }),
      terms: await tx.term.count(),
      currentTerms: await tx.term.count({ where: { isCurrent: true } }),
      students: await tx.student.count(),
      enrollments: await tx.enrollment.count(),
      invoices: await tx.invoice.count(),
    }));

    const bucket = bucketFor(c);
    tally[bucket] += 1;
    if (bucket !== "HEALTHY") {
      byStatus.set(`${bucket}/${s.status}`, (byStatus.get(`${bucket}/${s.status}`) ?? 0) + 1);
      stuck.push({ name: s.name, status: s.status, bucket, c });
    }
  }

  if (listMode) {
    for (const s of stuck) {
      console.log(
        `${s.bucket.padEnd(18)} ${s.name} [${s.status}] ` +
          `years=${s.c.years} currentYears=${s.c.currentYears} terms=${s.c.terms} ` +
          `currentTerms=${s.c.currentTerms} students=${s.c.students} ` +
          `enrollments=${s.c.enrollments} invoices=${s.c.invoices}`,
      );
    }
    console.log("");
  }

  const total = schools.length;
  const stuckCount = total - tally.HEALTHY;
  console.log(`Total schools:                                  ${total}`);
  console.log(`  HEALTHY (has a current term):                 ${tally.HEALTHY}`);
  console.log(`  PRISTINE (no year, no enrollments/invoices):  ${tally.PRISTINE}`);
  console.log(`  NO_CURRENT (has years, no current term):      ${tally.NO_CURRENT}`);
  console.log(`  NO_YEAR_WITH_DATA (should be 0 — FK):         ${tally.NO_YEAR_WITH_DATA}`);
  console.log("");
  console.log(`Stuck (cannot enroll / invoice / mark register): ${stuckCount}`);

  if (tally.NO_YEAR_WITH_DATA > 0) {
    console.log("");
    console.log(
      "WARNING: NO_YEAR_WITH_DATA is non-zero. Enrollment and Invoice both carry a " +
        "non-null termId, so this should be impossible. Investigate before acting on this census.",
    );
  }

  if (stuck.length > 0) {
    const breakdown = [...byStatus.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`Stuck by bucket/status: ${breakdown}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => basePrisma.$disconnect());
