// Pure helpers for the bulk student-add grid's submit pass.
//
// Extracted so they can be unit-tested: apps/web's Vitest runner is
// node-environment and *.spec.ts only (no DOM tests by standing decision), so
// logic that needs a test has to live outside the .tsx component.
//
// Deliberately NOT lifted into a shared "any multi-step save" abstraction.
// bulk-student-form.tsx's own header records the call not to refactor the
// student-creation path under time pressure, and one caller is not a pattern.
// If a second sequential-write loop needs `isTerminalAuthFailure`, lift it
// then — the class-subject matrix's loop already stops on ANY failure and so
// does not need it.

/**
 * Is this the kind of failure where continuing the loop is pointless?
 *
 * A 401 means the session is gone. Every remaining row would fail identically,
 * and each attempt dispatches another unauthorized event at a server that has
 * already refused — so the caller must stop rather than press on.
 *
 * Deliberately narrow. A 400 (bad row), a 409 (`ADMISSION_NUMBER_TAKEN`) or a
 * 500 says something about THAT row or that moment; the next row may well
 * succeed, and stopping would strand rows the user could have had. Only the
 * loss of the credential is terminal for the whole pass.
 *
 * 403 is NOT included. A permission failure is about what this row asks for,
 * not about whether the caller is still signed in, and the session survives it.
 */
export function isTerminalAuthFailure(error: { status?: number }): boolean {
  return error.status === 401;
}

/**
 * What to tell someone whose session ended partway through a bulk add.
 *
 * The one thing they must not be told is "fix the highlighted rows and submit
 * again" — nothing is wrong with the rows and re-submitting cannot work while
 * the credential is gone. The one thing they must be told is HOW MANY LANDED,
 * because those students exist and the grid is about to be replaced by the
 * login screen.
 *
 * `created` is never described as "may have been created": by the time this
 * runs the successful rows have returned 201 with an id. Hedging a fact we
 * hold would be its own kind of dishonesty.
 */
export function partialSaveNotice(created: number, attempted: number): string {
  if (created === 0) {
    return `You were signed out before any students were added. Sign in again and re-enter these ${attempted} rows.`;
  }
  return (
    `You were signed out after ${created} of ${attempted} ` +
    `student${created === 1 ? "" : "s"} ${created === 1 ? "was" : "were"} added. ` +
    `Those ${created} ${created === 1 ? "is" : "are"} saved — check the roster before re-entering the rest.`
  );
}
