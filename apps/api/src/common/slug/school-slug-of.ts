import { withTenant } from "@school-kit/db";

// The school's current code, for building its links (school-site-url.ts).
// `schools` has no RLS; withTenant keeps the read on the ordinary path.
export async function schoolSlugOf(schoolId: string): Promise<string | null> {
  const school = await withTenant(schoolId, (db) => db.school.findUnique({ where: { id: schoolId }, select: { slug: true } }));
  return school?.slug ?? null;
}
