import * as SecureStore from "expo-secure-store";

import { decodeStash, encodeStash, splitChunks, type DraftEntry, type StashOwner } from "./draft-stash";

// SecureStore for the forced-sign-out draft stash (./draft-stash.ts has the
// rules). SecureStore, not AsyncStorage: these are children's marks and a
// teacher's words, so they go to the Keychain / Keystore-encrypted storage the
// session token already uses, never to plaintext storage.
//
// Layout: a count item, then that many chunk items. Every failure degrades to
// "nothing stashed" — losing a draft is the behaviour this replaces, never an
// error in front of someone who is being signed out.

const COUNT_KEY = "sk_staff_draft_stash_n";
const chunkKey = (i: number) => `sk_staff_draft_stash_${i}`;

async function readCount(): Promise<number> {
  try {
    const n = Number(await SecureStore.getItemAsync(COUNT_KEY));
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function removeAll(): Promise<void> {
  const n = await readCount();
  await SecureStore.deleteItemAsync(COUNT_KEY).catch(() => undefined);
  for (let i = 0; i < n; i += 1) await SecureStore.deleteItemAsync(chunkKey(i)).catch(() => undefined);
}

/** Called when the server ends the session. Replaces any older stash. */
export async function stashDrafts(entries: readonly DraftEntry[]): Promise<void> {
  const encoded = encodeStash(entries, Date.now());
  if (encoded === null) return;
  try {
    await removeAll();
    const chunks = splitChunks(encoded);
    for (let i = 0; i < chunks.length; i += 1) await SecureStore.setItemAsync(chunkKey(i), chunks[i]!);
    // The count goes last: a stash interrupted half-way has no count and is
    // never read as complete.
    await SecureStore.setItemAsync(COUNT_KEY, String(chunks.length));
  } catch {
    await removeAll();
  }
}

/**
 * Called at every staff sign-in. Reads the stash, deletes it whoever is
 * signing in, and returns only what belongs to `me`.
 */
export async function takeStashedDrafts(me: StashOwner): Promise<DraftEntry[]> {
  const n = await readCount();
  if (n === 0) return [];
  let raw = "";
  try {
    for (let i = 0; i < n; i += 1) {
      const chunk = await SecureStore.getItemAsync(chunkKey(i));
      if (chunk === null) {
        raw = "";
        break;
      }
      raw += chunk;
    }
  } catch {
    raw = "";
  }
  await removeAll();
  return decodeStash(raw, me, Date.now());
}
