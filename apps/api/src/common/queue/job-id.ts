import { createHash } from "node:crypto";

// BullMQ custom job ids MUST NOT contain a colon — with one trapdoor.
//
// BullMQ builds its Redis keys as `bull:<queue>:<jobId>`, so a colon inside a
// custom id breaks key parsing. `Job.addJob` (bullmq 5.77.3,
// dist/cjs/classes/job.js) throws a bare `Error: Custom Id cannot contain :`
// — UNLESS the id happens to split into exactly three colon-separated parts,
// which it still allows for backwards compatibility with old repeatable jobs
// (their own TODO says to replace that check in the next breaking change).
//
// That exception is a trap for anyone verifying the rule by hand: a
// three-part probe id is accepted, so a test written from the error message
// alone can "prove" the rule does not exist. The first version of this file's
// spec did exactly that, and passed while production was failing.
//
// The thrown error is UNMODELLED, so HttpExceptionFilter turns it into a 500
// "An unexpected error occurred. Please try again." with nothing actionable
// in it.
//
// That is what shipped. Three enqueue sites built ids by interpolating a
// colon-separated `sessionRef` (or `parent-summary:<school>:<student>:<week>`),
// landing on four or five parts — past the three-part trapdoor — so EVERY
// call failed in production:
//
//   report-card-subject-comment:<term>:<arm>:<subject>:<student>   5 parts
//   report-card-form-comment:<term>:<arm>:<student>                4 parts
//   parent-summary:<school>:<student>:<isoWeek>                    4 parts
//
// covering report-card subject comments, form-teacher comments and weekly
// parent summaries. Found on 2026-09-19 in `school-kit-api`'s logs while
// testing subject comments from the phone. It is NOT a mobile bug — the web
// teacher gradebook's "Draft comments" button hit the same 500.
//
// The colon-bearing `sessionRef` values are NOT changed: they are stored in
// `ai_interaction_logs.session_ref` and matched on read, so changing them
// would orphan existing rows. Only the queue id is derived from them.

/**
 * Build a BullMQ-safe custom job id from parts.
 *
 * Each part keeps `[A-Za-z0-9_-]` — so uuids and ISO weeks stay readable in
 * Redis, which is where anyone debugging a stuck job will be looking — and the
 * parts are joined with `--`. Everything else, colons included, becomes `_`.
 *
 * A short digest of the ORIGINAL parts is appended, and THAT is what
 * guarantees two different tuples get two different ids. The readable half is
 * deliberately lossy (`["a-", "b"]` and `["a", "-b"]` flatten alike), and two
 * tuples sharing an id would make BullMQ silently drop the second job as a
 * duplicate — a student whose comment is never drafted, with no error
 * anywhere.
 *
 * Deterministic for the same inputs, because that duplicate-id dedupe is also
 * what stops a double-tapped button spending the school's AI budget twice.
 */
export function queueJobId(...parts: readonly string[]): string {
  if (parts.length === 0) throw new Error("queueJobId requires at least one part.");
  for (const part of parts) {
    if (part.trim() === "") throw new Error("queueJobId parts must be non-empty.");
  }
  // Length-prefixed, so the digest input is unambiguous whatever the parts
  // contain — no separator character has to be assumed absent from a uuid.
  const canonical = parts.map((part) => `${part.length}:${part}`).join("");
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 12);
  const readable = parts.map((part) => part.replace(/[^A-Za-z0-9_-]/g, "_")).join("--");
  const id = `${readable}-${digest}`;
  // Belt and braces: the whole point of this helper is that this cannot happen.
  if (id.includes(":")) throw new Error("queueJobId produced an id containing a colon.");
  return id;
}
