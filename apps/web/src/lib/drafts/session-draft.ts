// Unsaved work kept in this browser tab, so a forced sign-out (or a reload)
// doesn't take it (docs/deferred.md, "Session-end work loss"). The gradebook
// has its own module (lib/assessment/score-draft.ts); this is the same idea
// for forms whose drafts are one small JSON value: lesson plan sections and
// the class-subject matrix.
//
// The rules the gradebook draft set, kept here:
//   - sessionStorage only: per tab, gone when the tab closes;
//   - keyed by the signed-in user, so the next person on that tab never sees it;
//   - dropped after 12 hours, when emptied, and on a deliberate sign-out
//     (clearAllSessionDrafts, called by logout);
//   - never anything about a student: callers store their own form's values.
// Restoring is always the person's choice (Restore / Discard), and restored
// values come back UNSAVED: the form's own Save still does the writing.

const PREFIX = "sk_draft:";
export const SESSION_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface Stored<T> {
  v: 1;
  savedAt: number;
  data: T;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** A draft's key: what it is, whose it is, and which record. */
export function sessionDraftKey(kind: string, userId: string, recordId = ""): string {
  return `${PREFIX}${kind}:${userId}:${recordId}`;
}

/** Saves `data`, or removes the draft when `data` is null. */
export function writeSessionDraft<T>(key: string, data: T | null, now = Date.now()): void {
  const store = storage();
  if (!store) return;
  try {
    if (data === null) {
      store.removeItem(key);
      return;
    }
    const value: Stored<T> = { v: 1, savedAt: now, data };
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or blocked storage: the form still works, the safety net doesn't.
  }
}

export function readSessionDraft<T>(key: string, now = Date.now()): { savedAt: number; data: T } | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored<T>;
    if (stored?.v !== 1 || typeof stored.savedAt !== "number" || now - stored.savedAt > SESSION_DRAFT_MAX_AGE_MS) {
      store.removeItem(key);
      return null;
    }
    return { savedAt: stored.savedAt, data: stored.data };
  } catch {
    return null;
  }
}

export function clearSessionDraft(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // nothing to clear
  }
}

/** A deliberate sign-out leaves nothing behind for the next person. */
export function clearAllSessionDrafts(): void {
  const store = storage();
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // nothing to clear
  }
}
