// ===========================================================================
// TEMPORARY — CP2 marking-window safety rail. NOT the answer to D14.
// ===========================================================================
//
// D14 (how far back a teacher may mark attendance) is deliberately NOT decided
// here. The real policy is a product decision about how Nigerian schools
// actually reconcile a register — whether a Friday absence can be corrected on
// Monday, who may correct it, and whether a correction is visible. None of
// that is settled, and CP2 is not the place to settle it by accident.
//
// What this file is: a cheap, deliberately blunt default so that CP2's real
// device pilot, with a real teacher and a real register, cannot produce
// back-dated attendance while the policy is still open. It restricts marking
// from the phone to the SERVER's today.
//
// What it is NOT:
//   - Not a security boundary. The server still accepts any past date inside a
//     term from any caller holding `attendance.mark` — the web teacher surface
//     does exactly that today, by design. Removing this file would restore
//     mobile to web's behaviour, not open a hole.
//   - Not parity with web. Web allows back-dating with a date picker capped at
//     today. Mobile is deliberately narrower FOR NOW, and says so on screen.
//   - Not a reason to skip D14. When the window policy is decided, this file
//     is deleted and the decision replaces it in one place.
//
// The read path is deliberately unrestricted: a teacher may LOOK at an earlier
// register. Only the write is railed. Reading yesterday to check what happened
// is not the risk; silently writing to yesterday is.

export type MarkingBlockReason = "NOT_TODAY" | "NO_SERVER_CLOCK";

export interface MarkingWindow {
  canMark: boolean;
  reason: MarkingBlockReason | null;
}

/**
 * May the phone submit marks for `date`?
 *
 * `serverToday` is the server's calendar day (UTC, see server-date.ts), or
 * null when no API response has established the clock yet. A null clock
 * BLOCKS marking rather than falling back to the device clock: the whole point
 * of the rail is that the handset's own date is not trusted to define "today".
 * In practice this state is unreachable on a screen that just loaded a
 * register, because that load itself established the clock.
 */
export function markingWindow(date: string, serverToday: string | null): MarkingWindow {
  if (serverToday === null) return { canMark: false, reason: "NO_SERVER_CLOCK" };
  if (date !== serverToday) return { canMark: false, reason: "NOT_TODAY" };
  return { canMark: true, reason: null };
}

/** On-screen explanation. Says "for now" out loud — this rail is temporary. */
export function markingBlockMessage(reason: MarkingBlockReason): string {
  if (reason === "NO_SERVER_CLOCK") {
    return "We couldn't confirm today's date with the server. Reload before marking.";
  }
  return "For now, the app can only mark today's register. Use the web teacher portal to correct an earlier day.";
}
