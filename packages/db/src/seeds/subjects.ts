// Default Subject seed — genuinely track-independent core subjects only.
//
// Every new school created via signupOwner is auto-populated with these rows
// inside the same transaction that creates the school, mirroring
// DEFAULT_CLASS_LEVELS. Schools can then rename, deactivate, or delete via
// the existing subject-management UI — no new UI was introduced for this.
//
// Deliberately short. English Language, Mathematics, and Civic Education are
// the only three subjects that are (a) WAEC-compulsory core for every SSCE
// candidate regardless of SSS track (Science/Arts/Commercial), and (b) the
// same subject, same name, at every level from JSS through SSS. Candidates
// considered and rejected because they fail (b) past JSS: Basic Science and
// Social Studies both look universal but don't exist as SSS subjects at all
// — Basic Science splits into Biology/Chemistry/Physics, Social Studies
// gives way to Government/Economics/Geography. Seeding either would
// reintroduce the same track-blindness risk this shorter list exists to
// avoid. PHE and Computer Studies/ICT are common and track-independent too,
// but aren't WAEC-compulsory or consistently named at every level (especially
// KG) — left out of this first cut rather than stretched in.
//
// No ClassSubject rows are created here — these are bare catalogue entries.
// Linking a subject to specific levels stays a manual step via the existing
// class-subject matrix, same as any subject an admin types in by hand.
//
// Codes are stable per school and back the unique `(school_id, code)` index,
// same idempotency contract as DEFAULT_CLASS_LEVELS: createMany's
// `skipDuplicates: true` makes a hypothetical seed retry a no-op.

export interface DefaultSubject {
  code: string;
  name: string;
  category: "CORE" | "ELECTIVE" | "VOCATIONAL";
}

export const DEFAULT_SUBJECTS: readonly DefaultSubject[] = [
  { code: "english", name: "English Language", category: "CORE" },
  { code: "math", name: "Mathematics", category: "CORE" },
  { code: "civic-education", name: "Civic Education", category: "CORE" },
] as const;
