// ===========================================================================
// D14 — SETTLED 2026-09-20. The marking window is now PARITY WITH WEB.
// ===========================================================================
//
// CP2 shipped a deliberately blunt rail: the phone could mark only the
// server's today, so a real device pilot could not produce back-dated
// attendance while the policy was open. That file said, in as many words, that
// it was temporary and that deleting it would restore web's behaviour.
//
// What settled it is a market fact, not a technical one: **most Nigerian
// teachers have no laptop.** "Use the web teacher portal to correct an earlier
// day" reads as a workaround and is in practice a refusal — the teacher who
// forgot Friday's register cannot reach the surface the rail points them at.
// A rail that assumes a desk is worse than back-dating.
//
// So the window is now what web has always had: any past date the server
// accepts, and no future date. Three things did NOT change, and they are why
// this is not a widening of anyone's authority:
//
//   - The SERVER is unchanged and always was the boundary. It accepts any past
//     in-term date from a caller holding `attendance.mark`, and rejects future
//     dates itself (`resolveTermForDate`). This file has never been a security
//     control, and is not one now.
//   - "Today" still comes from the SERVER's clock, never the handset's. A
//     phone with a wrong date must not be able to define the window.
//   - A mark is still audited, and an amendment is still visible: the register
//     carries its last-marked stamp, so a corrected day is never silent.
//
// What IS lost is the pilot safety of "the phone cannot touch history". That
// was worth having while the policy was open; it is not worth a teacher being
// unable to fix Friday.

export type MarkingBlockReason = "FUTURE_DATE" | "NO_SERVER_CLOCK";

export interface MarkingWindow {
  canMark: boolean;
  reason: MarkingBlockReason | null;
}

/**
 * May the phone submit marks for `date`?
 *
 * `serverToday` is the server's calendar day (UTC, see server-date.ts), or
 * null when no API response has established the clock yet. A null clock BLOCKS
 * marking rather than falling back to the device clock: the handset's own date
 * is not trusted to define "today". In practice this state is unreachable on a
 * screen that just loaded a register, because that load established the clock.
 */
export function markingWindow(date: string, serverToday: string | null): MarkingWindow {
  if (serverToday === null) return { canMark: false, reason: "NO_SERVER_CLOCK" };
  // String comparison is correct for ISO yyyy-mm-dd and avoids re-parsing a
  // date into a zone, which is the trap the @db.Date convention exists to dodge.
  if (date > serverToday) return { canMark: false, reason: "FUTURE_DATE" };
  return { canMark: true, reason: null };
}

/** On-screen explanation for a blocked window. */
export function markingBlockMessage(reason: MarkingBlockReason): string {
  if (reason === "NO_SERVER_CLOCK") {
    return "We couldn't confirm today's date with the server. Reload before marking.";
  }
  return "You can't mark a register for a day that hasn't happened yet.";
}

/** Shift an ISO yyyy-mm-dd date by whole days, in UTC. */
export function shiftIsoDate(date: string, days: number): string {
  const ms = Date.parse(date + "T00:00:00.000Z");
  if (Number.isNaN(ms)) return date;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * How a chosen date reads to a teacher. "Today"/"Yesterday" carry more meaning
 * at a glance than a date string, and a back-dated register must never be
 * mistaken for today's.
 */
export function describeMarkingDate(date: string, serverToday: string | null): string {
  if (serverToday === null) return date;
  if (date === serverToday) return "Today";
  if (date === shiftIsoDate(serverToday, -1)) return "Yesterday";
  return date;
}
