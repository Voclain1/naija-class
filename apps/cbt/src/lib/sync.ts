import { CBT_SYNC_MAX_ATTEMPTS, signSyncBody, type CbtCryptoKey } from "@school-kit/types";

import { DeliveryError, OfflineError, sendAnswers } from "./api";
import { toSnapshot, type LocalAttempt } from "./attempt";
import { attemptsFor, deviceId, getSyncKey, markSent, sentFor } from "./store";

// Sending a sitting's saved answers (docs/modules/cbt.md D6): every attempt on
// this machine whose newest copy the server has not confirmed, in batches.
// Safe to run at any moment, as often as liked: the server keeps the highest
// copy, so a batch sent twice changes nothing.

export type SyncState =
  | { kind: "SENT"; pending: 0 }
  | { kind: "PENDING"; pending: number; reason: "OFFLINE" | "NO_KEY" | "ERROR" | "QUEUED"; message: string | null };

/** Attempts whose newest copy is not yet on the server (rejected ones never will be). */
export function unsent(attempts: LocalAttempt[], sent: Map<string, { sentSeq: number; rejected: string | null }>) {
  return attempts.filter((a) => {
    const s = sent.get(a.key);
    return !s?.rejected && a.seq > (s?.sentSeq ?? 0);
  });
}

export async function syncSitting(slug: string, sittingId: string, key?: CbtCryptoKey | null): Promise<SyncState> {
  let waiting = unsent(await attemptsFor(sittingId), await sentFor(sittingId));
  if (waiting.length === 0) return { kind: "SENT", pending: 0 };
  const signingKey = key ?? (await getSyncKey(sittingId));
  if (!signingKey) return { kind: "PENDING", pending: waiting.length, reason: "NO_KEY", message: null };
  const device = await deviceId();

  while (waiting.length > 0) {
    const batch = waiting.slice(0, CBT_SYNC_MAX_ATTEMPTS);
    try {
      const { results } = await sendAnswers(
        slug,
        sittingId,
        { deviceId: device, attempts: batch.map(toSnapshot) },
        (body) => signSyncBody(signingKey, body),
      );
      for (const r of results) {
        const attempt = batch.find((a) => a.studentId === r.studentId);
        if (attempt) await markSent(attempt.key, sittingId, r.seq, r.outcome === "REJECTED" ? (r.reason ?? "REJECTED") : null);
      }
    } catch (e) {
      const pending = waiting.length;
      if (e instanceof OfflineError) return { kind: "PENDING", pending, reason: "OFFLINE", message: null };
      return { kind: "PENDING", pending, reason: "ERROR", message: e instanceof DeliveryError ? e.message : "Could not send." };
    }
    waiting = waiting.slice(CBT_SYNC_MAX_ATTEMPTS);
  }
  const left = unsent(await attemptsFor(sittingId), await sentFor(sittingId)).length;
  // Anything left was chosen while the batch was in flight; the next round takes it.
  return left === 0 ? { kind: "SENT", pending: 0 } : { kind: "PENDING", pending: left, reason: "QUEUED", message: null };
}

/** For the screens: a short line about where the answers are. */
export function describeSync(state: SyncState | null): string {
  if (!state) return "";
  if (state.kind === "SENT") return "All answers sent to the school";
  const n = `${state.pending} student${state.pending === 1 ? "'s" : "s'"} answers`;
  if (state.reason === "OFFLINE") return `${n} saved on this computer — will send when the internet is back`;
  if (state.reason === "QUEUED") return "Sending answers…";
  if (state.reason === "NO_KEY") return `${n} saved on this computer — type the unlock code to send them`;
  return `${n} saved on this computer — ${state.message ?? "could not send"}`;
}
