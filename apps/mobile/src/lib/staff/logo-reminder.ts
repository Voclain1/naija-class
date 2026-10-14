// When the app reminds an owner or admin to add the school's logo — the web
// dashboard's rule (apps/web/src/lib/dashboard/logo-reminder-state.ts), brought
// to the app by the pre-build audit (2026-10-14). Closable, and back after
// REMIND_AFTER_SESSIONS more sittings until a logo is uploaded. A "sitting" in
// the app is one run of it: the store counts a school once per launch.
//
// React-Native-free so a spec can reach it; AsyncStorage lives in
// ./logo-reminder-store.

export const REMIND_AFTER_SESSIONS = 3;

export interface ReminderRecord {
  sessions: number;
  dismissedAtSession: number | null;
}

export const FRESH_RECORD: ReminderRecord = { sessions: 0, dismissedAtSession: null };

/** A stored record, or a fresh one for anything unreadable. */
export function parseRecord(raw: string | null): ReminderRecord {
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<ReminderRecord>) : {};
    return {
      sessions: typeof parsed.sessions === "number" ? parsed.sessions : 0,
      dismissedAtSession: typeof parsed.dismissedAtSession === "number" ? parsed.dismissedAtSession : null,
    };
  } catch {
    return { ...FRESH_RECORD };
  }
}

export function countSitting(record: ReminderRecord): ReminderRecord {
  return { ...record, sessions: record.sessions + 1 };
}

export function dismiss(record: ReminderRecord): ReminderRecord {
  return { ...record, dismissedAtSession: record.sessions };
}

export function shouldRemind(record: ReminderRecord): boolean {
  return record.dismissedAtSession === null || record.sessions - record.dismissedAtSession >= REMIND_AFTER_SESSIONS;
}
