// When the "Add your school's logo" reminder shows (owner's request,
// 2026-10-11): closable, and back after a few sessions until the logo is
// uploaded. A per-viewer convenience, so it lives in the browser: one record
// per school in localStorage, and a per-tab marker in sessionStorage so that
// one sitting counts once however often the dashboard is opened.
//
// Storage can be missing or throw (private windows, blocked site data); every
// access is guarded, and with no storage the reminder simply shows, closable
// for the rest of that page view.

export const REMIND_AFTER_SESSIONS = 3;

export interface ReminderRecord {
  sessions: number;
  dismissedAtSession: number | null;
}

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const recordKey = (schoolId: string) => `sk:logo-reminder:${schoolId}`;
const sessionKey = (schoolId: string) => `sk:logo-reminder-session:${schoolId}`;

function read(store: KeyValueStore, schoolId: string): ReminderRecord {
  try {
    const raw = store.getItem(recordKey(schoolId));
    const parsed = raw ? (JSON.parse(raw) as Partial<ReminderRecord>) : {};
    return {
      sessions: typeof parsed.sessions === "number" ? parsed.sessions : 0,
      dismissedAtSession: typeof parsed.dismissedAtSession === "number" ? parsed.dismissedAtSession : null,
    };
  } catch {
    return { sessions: 0, dismissedAtSession: null };
  }
}

function write(store: KeyValueStore, schoolId: string, record: ReminderRecord): void {
  try {
    store.setItem(recordKey(schoolId), JSON.stringify(record));
  } catch {
    // Nowhere to remember it: the reminder just comes back next time.
  }
}

/** Counts this sitting (once per tab session) and returns the up-to-date record. */
export function noteSession(local: KeyValueStore, session: KeyValueStore, schoolId: string): ReminderRecord {
  const record = read(local, schoolId);
  let counted = false;
  try {
    counted = session.getItem(sessionKey(schoolId)) !== null;
    if (!counted) session.setItem(sessionKey(schoolId), "1");
  } catch {
    counted = true; // Cannot tell sittings apart: do not count at all.
  }
  if (counted) return record;
  const next = { ...record, sessions: record.sessions + 1 };
  write(local, schoolId, next);
  return next;
}

export function shouldRemind(record: ReminderRecord): boolean {
  return record.dismissedAtSession === null || record.sessions - record.dismissedAtSession >= REMIND_AFTER_SESSIONS;
}

export function dismissReminder(local: KeyValueStore, schoolId: string): void {
  const record = read(local, schoolId);
  write(local, schoolId, { ...record, dismissedAtSession: record.sessions });
}
