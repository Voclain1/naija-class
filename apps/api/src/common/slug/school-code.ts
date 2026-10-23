import { basePrisma } from "@school-kit/db";

// Resolving a school code, current or old (docs/modules/school-addresses.md).
//
// A school may change its address (schools.slug); its earlier codes live in
// school_previous_addresses and keep working forever. Every public surface that
// takes a code — student sign-in, the result checker, the admission form, exam
// packs, ID card checks — resolves it here, so a printed PIN card or a code on
// a student's phone still finds the school after a change.
//
// Neither read needs a tenant: `schools` has no RLS, and
// school_previous_addresses has a read-all policy (codes are public).

const CODE_RE = /^[a-z0-9-]{1,80}$/;

export function normaliseCode(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface ResolvedSchoolCode {
  schoolId: string;
  /** The school's CURRENT code. */
  slug: string;
  /** True when the code given was one of the school's earlier codes. */
  previous: boolean;
}

export async function resolveSchoolCode(raw: string): Promise<ResolvedSchoolCode | null> {
  const code = normaliseCode(raw);
  if (!CODE_RE.test(code)) return null;
  const school = await basePrisma.school.findUnique({ where: { slug: code }, select: { id: true, slug: true } });
  if (school) return { schoolId: school.id, slug: school.slug, previous: false };
  const old = await basePrisma.schoolPreviousAddress.findUnique({
    where: { slug: code },
    select: { school: { select: { id: true, slug: true } } },
  });
  return old ? { schoolId: old.school.id, slug: old.school.slug, previous: true } : null;
}

/**
 * The school's current code for whatever was typed, or the typed code itself
 * (normalised) when no school has it. For surfaces that must behave the same
 * for a known and an unknown school (student sign-in, the result checker), so
 * their lockout counters and lookups key on one code per school.
 */
export async function currentSchoolCode(raw: string): Promise<string> {
  return (await resolveSchoolCode(raw))?.slug ?? normaliseCode(raw);
}

/** Whether a code is in use by any school, now or before. */
export async function schoolCodeTaken(code: string): Promise<boolean> {
  const [current, old] = await Promise.all([
    basePrisma.school.findUnique({ where: { slug: code }, select: { id: true } }),
    basePrisma.schoolPreviousAddress.findUnique({ where: { slug: code }, select: { id: true } }),
  ]);
  return current !== null || old !== null;
}

/**
 * Sign-in at a school's own address (docs/modules/school-hosted-apps.md): the
 * staff and parent sign-in pages there send the school's code, and only an
 * account at that school may sign in. No code (portal.schoolkit.ng,
 * app.schoolkit.ng, the apps) allows any school; a code no school has allows
 * none, so it fails exactly like a wrong password.
 */
export async function signInSchoolScope(rawCode: string | undefined): Promise<(schoolId: string) => boolean> {
  if (rawCode === undefined) return () => true;
  const found = await resolveSchoolCode(rawCode);
  return (schoolId) => found !== null && found.schoolId === schoolId;
}
