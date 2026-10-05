import {
  CBT_SIGNATURE_HEADER,
  type CbtPackDownloadDto,
  type CbtSyncBatch,
  type CbtSyncResultDto,
} from "@school-kit/types";

// The two public delivery calls (docs/modules/cbt.md D9). Straight from the
// browser to the API — there is no server of our own in between, so the app
// works as a set of static files a lab machine can keep offline.

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1").replace(/\/$/, "");

export class DeliveryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** No answer at all: the machine is offline, or the server is unreachable. */
export class OfflineError extends Error {
  constructor() {
    super("No internet connection.");
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, cache: "no-store" });
  } catch {
    throw new OfflineError();
  }
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new DeliveryError(res.status, body?.error?.code ?? "ERROR", body?.error?.message ?? "Something went wrong. Try again.");
  }
  return body as T;
}

export function downloadPack(slug: string, accessCode: string): Promise<CbtPackDownloadDto> {
  return call(`/cbt-delivery/${encodeURIComponent(slug)}/packs/${encodeURIComponent(accessCode.trim())}`);
}

/** `body` is the exact JSON string `signature` was computed over. */
export function sendAnswers(slug: string, sittingId: string, batch: CbtSyncBatch, sign: (body: string) => Promise<string>) {
  const body = JSON.stringify(batch);
  return sign(body).then((signature) =>
    call<CbtSyncResultDto>(`/cbt-delivery/${encodeURIComponent(slug)}/sittings/${encodeURIComponent(sittingId)}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [CBT_SIGNATURE_HEADER]: signature },
      body,
    }),
  );
}
