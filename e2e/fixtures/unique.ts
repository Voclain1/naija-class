// Per-run unique identifiers so re-runs against the same dev DB never collide
// on the unique constraints School.slug, User.email, User.phone, etc. The
// existing Phase 0 happy-path test uses the same idea inline; cp4 centralises
// it because three actors (admin + two teachers) now need unique strings.
//
// `seq` makes two calls in the SAME millisecond distinct (Date.now() alone can
// repeat within a tight loop). We deliberately avoid threading a seed through
// every helper — a monotonic counter plus the wall clock is enough entropy for
// a single-worker, serial suite.

let seq = 0;

function nextSeq(): string {
  seq += 1;
  return seq.toString(36);
}

// A short, lowercase, collision-resistant token safe for slugs and codes
// (lowercase letters + digits only — matches the slug/code regexes the API
// enforces: `^[a-z0-9-]` shapes).
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${nextSeq()}`;
}

// Globally-unique phone for an owner signup. The User.phone column is unique
// across ALL schools (a Phase 0 constraint), so this needs more care than the
// per-school strings. 10 digits after the +234 country code keeps it inside
// the API's "10–15 digits" rule. Last 6 of the ms clock + 4 random digits is
// astronomically unlikely to repeat across the handful of owners a suite run
// creates.
export function uniquePhone(): string {
  const clock = Date.now().toString().slice(-6);
  const rand = Math.floor(Math.random() * 10_000)
    .toString()
    .padStart(4, "0");
  return `+234${clock}${rand}`;
}
