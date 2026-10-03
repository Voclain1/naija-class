import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

// Per-CLIENT throttling on Fly (2026-10-03, found while building the public
// Result Checker, docs/modules/phase-8.md §21.8).
//
// @nestjs/throttler keys each limit on `req.ip`. This API never sets Express
// `trust proxy` and runs behind Fly's proxy, so `req.ip` is the address the
// connection came from — Fly's proxy — rather than the family on the other
// end. Read that way, every per-IP limit (200/min globally, 5/min on student
// sign-in, 5/min on the checker) is shared by everyone at once: a busy
// results morning would start refusing the whole country after five checks a
// minute.
//
// Fly's proxy sets `Fly-Client-IP` to the address it accepted the connection
// from, on every request it forwards. That is the client this guard keys on.
// Where the header is absent — local dev, CI, tests — the socket address is
// the client, as before. If Fly were already presenting real client addresses
// as the socket address, the two are equal and this changes nothing.
//
// Not used for anything security-bearing beyond rate limiting: the per-identity
// lockouts (login-lockout.ts) key on what was typed, not on any address.
export const FLY_CLIENT_IP_HEADER = "fly-client-ip";

export function clientIp(req: {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string {
  const raw = req.headers?.[FLY_CLIENT_IP_HEADER];
  const fly = Array.isArray(raw) ? raw[0] : raw;
  if (typeof fly === "string" && fly.trim()) return fly.trim();
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return clientIp(req as Parameters<typeof clientIp>[0]);
  }
}
