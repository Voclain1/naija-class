import type { CbtCryptoKey, CbtPackEnvelope } from "@school-kit/types";

import type { LocalAttempt } from "./attempt";

// Everything this lab machine keeps (docs/modules/cbt.md D6), in IndexedDB so
// it survives a power cut:
//   * packs    — the ENCRYPTED envelopes, as downloaded. Never the opened
//                questions: those live in memory only, until the unlock code
//                is typed again.
//   * attempts — each student's answers, saved after every choice.
//   * sent     — the highest `seq` the server has confirmed per attempt. Kept
//                apart from `attempts` so a sync finishing mid-exam can never
//                write over an answer chosen while it was in flight.
//   * meta     — this machine's id, and each sitting's SIGNING key. That key
//                is a non-extractable WebCrypto key: the browser can sign with
//                it but will not hand its bytes to anyone, so answers saved
//                before a restart can still be sent without the unlock code.
//                It cannot open the questions.

export interface StoredPack {
  sittingId: string;
  slug: string;
  envelope: CbtPackEnvelope;
  downloadedAt: string;
}

export interface SentState {
  key: string;
  sittingId: string;
  sentSeq: number;
  /** Set when the server said it will never accept this attempt. */
  rejected: string | null;
}

const DB_NAME = "school-kit-cbt";
const DB_VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;
let device: Promise<string> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("packs", { keyPath: "sittingId" });
      d.createObjectStore("attempts", { keyPath: "key" }).createIndex("sittingId", "sittingId");
      d.createObjectStore("sent", { keyPath: "key" }).createIndex("sittingId", "sittingId");
      d.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

/** For specs: forget the open connection (fake-indexeddb is reset between them). */
export function resetStoreConnection(): void {
  opening = null;
  device = null;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: string, mode: IDBTransactionMode) {
  return (await db()).transaction(name, mode).objectStore(name);
}

// ---- packs ----------------------------------------------------------------

export async function savePack(pack: StoredPack): Promise<void> {
  await done((await store("packs", "readwrite")).put(pack));
}

export async function listPacks(slug: string): Promise<StoredPack[]> {
  const all = await done((await store("packs", "readonly")).getAll() as IDBRequest<StoredPack[]>);
  return all.filter((p) => p.slug === slug).sort((a, b) => a.envelope.startsAt.localeCompare(b.envelope.startsAt));
}

// ---- attempts -------------------------------------------------------------

export async function saveAttempt(attempt: LocalAttempt): Promise<void> {
  await done((await store("attempts", "readwrite")).put(attempt));
}

export async function getAttempt(key: string): Promise<LocalAttempt | null> {
  return ((await done((await store("attempts", "readonly")).get(key))) as LocalAttempt | undefined) ?? null;
}

export async function attemptsFor(sittingId: string): Promise<LocalAttempt[]> {
  const index = (await store("attempts", "readonly")).index("sittingId");
  return done(index.getAll(sittingId) as IDBRequest<LocalAttempt[]>);
}

// ---- sent -----------------------------------------------------------------

export async function sentFor(sittingId: string): Promise<Map<string, SentState>> {
  const index = (await store("sent", "readonly")).index("sittingId");
  const rows = await done(index.getAll(sittingId) as IDBRequest<SentState[]>);
  return new Map(rows.map((r) => [r.key, r]));
}

/** Records the server's answer; only ever moves `sentSeq` forward. */
export async function markSent(key: string, sittingId: string, seq: number, rejected: string | null): Promise<void> {
  const s = await store("sent", "readwrite");
  const prev = ((await done(s.get(key))) as SentState | undefined) ?? { key, sittingId, sentSeq: 0, rejected: null };
  await done(s.put({ ...prev, sentSeq: Math.max(prev.sentSeq, seq), rejected: rejected ?? prev.rejected }));
}

// ---- meta -----------------------------------------------------------------

async function getMeta<T>(key: string): Promise<T | null> {
  return ((await done((await store("meta", "readonly")).get(key))) as T | undefined) ?? null;
}

async function setMeta(key: string, value: unknown): Promise<void> {
  await done((await store("meta", "readwrite")).put(value, key));
}

/**
 * This machine's id, made once. Several students may use one machine. Read
 * and, if absent, written in ONE transaction — and the promise is shared — so
 * two syncs starting together cannot each mint an id, which would make one
 * student look like they sat on two computers (D5).
 */
export function deviceId(): Promise<string> {
  device ??= (async () => {
    const meta = await store("meta", "readwrite");
    const existing = (await done(meta.get("deviceId"))) as string | undefined;
    if (existing) return existing;
    const id = crypto.randomUUID();
    await done(meta.put(id, "deviceId"));
    return id;
  })().catch((e: unknown) => {
    device = null;
    throw e;
  });
  return device;
}

export const getSyncKey = (sittingId: string) => getMeta<CbtCryptoKey>(`syncKey:${sittingId}`);
export const saveSyncKey = (sittingId: string, key: CbtCryptoKey) => setMeta(`syncKey:${sittingId}`, key);
