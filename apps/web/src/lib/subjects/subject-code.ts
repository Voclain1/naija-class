// A code for a subject a school types in (2026-11-02). Codes are the
// per-school unique key: lowercase letters, digits and hyphens, at most 20.
// The school never sees or types one on the Subjects by class page.

const MAX = 20;

export function newSubjectCode(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX)
      .replace(/-+$/g, "") || "subject";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const code = `${base.slice(0, MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!used.has(code)) return code;
  }
}
