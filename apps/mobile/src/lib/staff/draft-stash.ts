// The forced-sign-out stash for unsaved staff work (owner's decision on the
// pre-build audit, 2026-10-14; staff-mobile-companion.md, "D19 and D24
// revisited").
//
// When the server ends a staff session (a 401), the in-memory drafts —
// unsaved marks, "out of" totals, report comments, lesson-note sections — are
// written to SecureStore, and handed back when the SAME person signs in to the
// SAME school again. Anyone else signing in on the handset discards them
// unread. They also expire after STASH_MAX_AGE_MS, so a handset does not hold a
// class's marks indefinitely.
//
// The rules are here, React-Native-free so a spec can reach them; the
// SecureStore half is ./draft-stash-store.ts.

export const STASH_VERSION = 1;
export const STASH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Characters per SecureStore item. No item gets large, however long a note. */
export const STASH_CHUNK_CHARS = 8000;

export type DraftEntry = [string, Record<string, string>];

export interface StashOwner {
  schoolId: string;
  userId: string;
}

interface Stash {
  v: number;
  savedAt: number;
  entries: DraftEntry[];
}

/**
 * Whose draft a key is. Every draft key begins with a JSON array whose first
 * two elements are the school and the user (gradebook-drafts.ts), followed by
 * "|" and the kind.
 */
export function ownerOfKey(key: string): StashOwner | null {
  const bar = key.indexOf("|");
  if (bar <= 0) return null;
  try {
    const parts: unknown = JSON.parse(key.slice(0, bar));
    if (!Array.isArray(parts) || typeof parts[0] !== "string" || typeof parts[1] !== "string") return null;
    return { schoolId: parts[0], userId: parts[1] };
  } catch {
    return null;
  }
}

function hasText(cells: Record<string, string>): boolean {
  return Object.values(cells).some((v) => typeof v === "string" && v !== "");
}

/** The stash to write, or null when there is nothing worth keeping. */
export function encodeStash(entries: readonly DraftEntry[], now: number): string | null {
  const kept = entries.filter(([key, cells]) => ownerOfKey(key) !== null && hasText(cells));
  if (kept.length === 0) return null;
  const stash: Stash = { v: STASH_VERSION, savedAt: now, entries: kept };
  return JSON.stringify(stash);
}

/**
 * The drafts to give back to `me`: only keys that are theirs, only from a
 * stash that is readable and not expired. Everything else is dropped.
 */
export function decodeStash(raw: string | null, me: StashOwner, now: number): DraftEntry[] {
  if (!raw) return [];
  let stash: Stash;
  try {
    stash = JSON.parse(raw) as Stash;
  } catch {
    return [];
  }
  if (stash?.v !== STASH_VERSION || typeof stash.savedAt !== "number" || !Array.isArray(stash.entries)) return [];
  if (now - stash.savedAt > STASH_MAX_AGE_MS || stash.savedAt > now + 60_000) return [];
  const out: DraftEntry[] = [];
  for (const entry of stash.entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "object" || entry[1] === null) continue;
    const owner = ownerOfKey(entry[0]);
    if (!owner || owner.schoolId !== me.schoolId || owner.userId !== me.userId) continue;
    const cells: Record<string, string> = {};
    for (const [k, v] of Object.entries(entry[1])) if (typeof v === "string") cells[k] = v;
    if (hasText(cells)) out.push([entry[0], cells]);
  }
  return out;
}

export function splitChunks(text: string, size: number = STASH_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}
