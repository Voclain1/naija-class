import { createHmac, timingSafeEqual } from "node:crypto";

const HEX = /^[0-9a-f]{128}$/;
const KID = /^whk_[A-Za-z0-9_-]{1,80}$/;

export function readPaystackSigningKeys(input: string | undefined): Map<string, string> {
  const keys = new Map<string, string>();
  if (!input) return keys;
  try {
    const parsed: unknown = JSON.parse(input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return keys;
    const entries = Object.entries(parsed);
    if (entries.length > 8 || entries.some(([kid, secret]) =>
      !KID.test(kid) || typeof secret !== "string" || !/^whsec_[A-Za-z0-9_-]{1,256}$/.test(secret))) return keys;
    for (const [kid, secret] of entries) keys.set(kid, secret as string);
  } catch {
    return new Map();
  }
  return keys;
}

export function verifyModernPaystackSignature(
  rawBody: Buffer, header: unknown, keys: ReadonlyMap<string, string>, now = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof header !== "string" || header.length > 8192) return false;
  let timestamp: string | undefined;
  const signatures: Array<{ kid: string; digest: string }> = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === "t") {
      if (timestamp !== undefined || !/^(0|[1-9]\d{0,11})$/.test(value)) return false;
      timestamp = value;
    } else if (name === "v1") {
      const colon = value.indexOf(":");
      if (colon < 0) continue;
      const kid = value.slice(0, colon);
      const digest = value.slice(colon + 1);
      if (KID.test(kid) && HEX.test(digest)) signatures.push({ kid, digest });
    }
  }
  if (!timestamp || Math.abs(now - Number(timestamp)) > 300) return false;
  let valid = false;
  for (const { kid, digest } of signatures) {
    const secret = keys.get(kid);
    if (!secret) continue;
    const expected = createHmac("sha512", secret).update(timestamp + ".").update(rawBody).digest();
    if (timingSafeEqual(expected, Buffer.from(digest, "hex"))) valid = true;
  }
  return valid;
}
