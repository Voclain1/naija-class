import { createHmac, timingSafeEqual } from "node:crypto";

// DEV-ONLY shared signing for the filesystem storage driver. The filesystem
// driver's signUrl() returns an HTTP URL pointing at DevStorageController (which
// streams the file from local disk), instead of a file:// URL that browsers
// refuse to load. Production uses the R2 driver, whose signUrl() returns a real
// https:// presigned URL — none of this is involved there.
//
// The URL carries `exp` (expiry, ms epoch) + `sig` (HMAC over the canonical
// storage path + exp). The controller recomputes the HMAC with the same secret
// and rejects on mismatch or expiry — the dev analogue of an R2 signature, so
// the dev file server isn't an open directory listing.

// Route segment (under the api/v1 global prefix): /api/v1/dev-storage/<path>.
export const DEV_STORAGE_PATH = "dev-storage";

// DI tokens so the driver factory (signer) and the controller (verifier) share
// the exact same resolved root + secret — no drift between sign and verify.
export const STORAGE_FS_ROOT = "STORAGE_FS_ROOT";
export const DEV_STORAGE_SECRET = "DEV_STORAGE_SECRET";

export function computeDevStorageSig(canonical: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${canonical}.${exp}`).digest("hex");
}

// True only if the signature matches AND the URL hasn't expired. Constant-time
// compare on the hex strings themselves — NOT Buffer.from(sig, "hex"), which
// silently truncates at the first non-hex char (so appended garbage would still
// decode to a matching prefix). Comparing the raw hex strings (equal length
// required) rejects both length mismatches and any altered digit.
export function verifyDevStorageSig(
  canonical: string,
  exp: number,
  sig: string,
  secret: string,
): boolean {
  if (!Number.isFinite(exp) || Date.now() >= exp) return false;
  if (typeof sig !== "string") return false;
  const expected = computeDevStorageSig(canonical, exp, secret);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
