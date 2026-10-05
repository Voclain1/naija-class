import { normaliseCbtCode } from "./cbt-codes.js";
import type { CbtPackEnvelope, CbtPackPayload } from "./cbt-pack.js";

// Online exams (CBT2) — the lab machine's side of the pack crypto
// (docs/modules/cbt.md D3, D6). WebCrypto only (`globalThis.crypto.subtle`),
// which every supported browser has and Node 22 has too, so the API's specs
// exercise this exact code against packs the server built.
//
// Two keys come from the unlock code:
//   * the PACK key — PBKDF2 with the envelope's random salt → AES-256-GCM,
//     to open the questions;
//   * the SYNC key — PBKDF2 with a fixed, per-sitting salt → HMAC-SHA256, to
//     sign every batch of answers. Only a machine that was unlocked can send
//     answers for a sitting; the server holds the unlock code and checks.
// Both at the pack's iteration count: the same cost to an attacker either way.

// This package compiles against ES2022 only (no DOM, no Node types), so the
// few WebCrypto and encoding members used here are declared structurally.
/** An opaque WebCrypto key. Non-extractable; safe to keep in IndexedDB. */
export type CbtCryptoKey = object;
interface SubtleLike {
  importKey(format: "raw", data: Uint8Array, algorithm: "PBKDF2", extractable: false, usages: string[]): Promise<CbtCryptoKey>;
  deriveKey(algorithm: object, base: CbtCryptoKey, derived: object, extractable: false, usages: string[]): Promise<CbtCryptoKey>;
  decrypt(algorithm: object, key: CbtCryptoKey, data: Uint8Array): Promise<ArrayBuffer>;
  sign(algorithm: "HMAC", key: CbtCryptoKey, data: Uint8Array): Promise<ArrayBuffer>;
}
interface WebGlobals {
  crypto?: { subtle?: SubtleLike };
  TextEncoder: new () => { encode(text: string): Uint8Array };
  TextDecoder: new () => { decode(bytes: ArrayBuffer): string };
  atob(b64: string): string;
  btoa(bin: string): string;
}
const web = () => globalThis as unknown as WebGlobals;

const subtle = (): SubtleLike => {
  const s = web().crypto?.subtle;
  if (!s) throw new Error("This browser cannot open exam packs (WebCrypto is missing).");
  return s;
};

// Made on first use, not at import: this file is in @school-kit/types' main
// entry, which the mobile app imports too.
const utf8 = (text: string) => new (web().TextEncoder)().encode(text);

function fromBase64(b64: string): Uint8Array {
  const bin = web().atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return web().btoa(bin);
}

async function pbkdf2Key(unlockCode: string, salt: Uint8Array, iterations: number, usage: "AES" | "HMAC"): Promise<CbtCryptoKey> {
  const base = await subtle().importKey("raw", utf8(normaliseCbtCode(unlockCode)), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    usage === "AES" ? { name: "AES-GCM", length: 256 } : { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    usage === "AES" ? ["decrypt"] : ["sign"],
  );
}

/** The fixed salt for a sitting's sync key. The server uses the same string. */
export const cbtSyncSalt = (sittingId: string) => `school-kit-cbt-sync:${sittingId}`;

export class WrongUnlockCodeError extends Error {
  constructor() {
    super("That unlock code is not right for this exam.");
  }
}

/** Opens a pack. A wrong code fails GCM authentication → WrongUnlockCodeError. */
export async function openPackInBrowser(envelope: CbtPackEnvelope, unlockCode: string): Promise<CbtPackPayload> {
  const key = await pbkdf2Key(unlockCode, fromBase64(envelope.kdf.salt), envelope.kdf.iterations, "AES");
  try {
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.cipher.iv) },
      key,
      fromBase64(envelope.ciphertext),
    );
    return JSON.parse(new (web().TextDecoder)().decode(plain)) as CbtPackPayload;
  } catch {
    throw new WrongUnlockCodeError();
  }
}

/** The machine's signing key for a sitting's answer batches. */
export function deriveSyncKey(unlockCode: string, sittingId: string, iterations: number): Promise<CbtCryptoKey> {
  return pbkdf2Key(unlockCode, utf8(cbtSyncSalt(sittingId)), iterations, "HMAC");
}

/** base64 HMAC-SHA256 of the exact request body. */
export async function signSyncBody(key: CbtCryptoKey, body: string): Promise<string> {
  return toBase64(await subtle().sign("HMAC", key, utf8(body)));
}
