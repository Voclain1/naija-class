import { deriveSyncKey, signSyncBody, type CbtCryptoKey } from "@school-kit/types";

// The invigilator proves they hold the unlock code again — for a late start or
// extra time — without the app keeping the code anywhere: the typed code's
// signing key must sign a test string exactly as the stored key does.
export async function isUnlockCode(typed: string, sittingId: string, iterations: number, storedKey: CbtCryptoKey): Promise<boolean> {
  const probe = `school-kit-cbt-invigilator:${sittingId}`;
  const candidate = await deriveSyncKey(typed, sittingId, iterations);
  return (await signSyncBody(candidate, probe)) === (await signSyncBody(storedKey, probe));
}
