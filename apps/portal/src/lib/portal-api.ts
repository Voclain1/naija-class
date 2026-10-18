import { buildLoginUrl, errorCodeFromBody, reasonFromErrorCode } from "@/lib/session-end";

// A JSON call through the portal's proxy (/api/portal/…). A 401 sends the
// parent to sign in, back to this page afterwards; any other failure comes
// back as the API's own message.

export type PortalResult<T> = { ok: true; body: T } | { ok: false; message: string; redirected?: boolean };

export async function portalJson<T>(path: string, init: RequestInit & { json?: unknown } = {}, onUnauthorised?: (url: string) => void): Promise<PortalResult<T>> {
  try {
    const res = await fetch(`/api/portal${path}`, {
      ...init,
      ...(init.json !== undefined ? { body: JSON.stringify(init.json), headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } } : {}),
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 401) {
      onUnauthorised?.(buildLoginUrl({ reason: reasonFromErrorCode(errorCodeFromBody(body)), next: `${window.location.pathname}${window.location.search}` }));
      return { ok: false, message: "Please sign in again.", redirected: true };
    }
    if (!res.ok) {
      const message =
        body !== null && typeof body === "object" && "error" in body
          ? ((body as { error?: { message?: string } }).error?.message ?? "Something went wrong. Try again.")
          : "Could not reach the server. Try again in a moment.";
      return { ok: false, message };
    }
    return { ok: true, body: body as T };
  } catch {
    return { ok: false, message: "Could not reach the server. Try again in a moment." };
  }
}

export function messageTime(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
