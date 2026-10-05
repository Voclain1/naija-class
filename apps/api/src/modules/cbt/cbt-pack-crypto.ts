import * as crypto from "node:crypto";
import { promisify } from "node:util";

import {
  CBT_ACCESS_CODE_LENGTH,
  CBT_CODE_ALPHABET,
  CBT_PACK_FORMAT,
  CBT_PACK_KDF,
  CBT_UNLOCK_CODE_LENGTH,
  normaliseCbtCode,
  type CbtPackEnvelope,
  type CbtPackPayload,
} from "@school-kit/types";

// Online exams (CBT) — building and opening the exam pack (docs/modules/cbt.md
// D3). Standard primitives only: PBKDF2-SHA256 to derive a key from the unlock
// code, AES-256-GCM to encrypt. The lab machine opens the same envelope with
// WebCrypto; `openPack` here is the server-side mirror, used by the specs to
// prove the round trip and by nothing else.
//
// WebCrypto's AES-GCM output is the ciphertext with the 16-byte tag APPENDED;
// Node returns the tag separately. The envelope stores WebCrypto's form.

const pbkdf2 = promisify(crypto.pbkdf2);
const TAG_BYTES = 16;

/** A random code from the no-look-alikes alphabet, from Node's CSPRNG. */
export function randomCbtCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += CBT_CODE_ALPHABET[crypto.randomInt(CBT_CODE_ALPHABET.length)];
  return out;
}

export const newAccessCode = () => randomCbtCode(CBT_ACCESS_CODE_LENGTH);
export const newUnlockCode = () => randomCbtCode(CBT_UNLOCK_CODE_LENGTH);

async function deriveKey(unlockCode: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return pbkdf2(normaliseCbtCode(unlockCode), salt, iterations, CBT_PACK_KDF.keyLengthBits / 8, "sha256");
}

export async function buildPackEnvelope(
  payload: CbtPackPayload,
  unlockCode: string,
  meta: Omit<CbtPackEnvelope, "format" | "sittingId" | "kdf" | "cipher" | "ciphertext">,
): Promise<CbtPackEnvelope> {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(unlockCode, salt, CBT_PACK_KDF.iterations);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final(), cipher.getAuthTag()]);
  return {
    format: CBT_PACK_FORMAT,
    sittingId: payload.sittingId,
    ...meta,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: CBT_PACK_KDF.iterations, salt: salt.toString("base64") },
    cipher: { name: "AES-GCM", iv: iv.toString("base64") },
    ciphertext: body.toString("base64"),
  };
}

/** Opens an envelope; throws on a wrong code (GCM authentication fails). */
export async function openPack(envelope: CbtPackEnvelope, unlockCode: string): Promise<CbtPackPayload> {
  const key = await deriveKey(unlockCode, Buffer.from(envelope.kdf.salt, "base64"), envelope.kdf.iterations);
  const body = Buffer.from(envelope.ciphertext, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.cipher.iv, "base64"));
  decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
  const plain = Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as CbtPackPayload;
}
