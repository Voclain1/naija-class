// Downloads a file the API built (Excel today; any binary body), keeping the
// session: a plain <a href> to the API would not carry the staff session the
// way apiFetch does, so the body is fetched and handed to the browser as a
// blob. The name comes from the API's Content-Disposition, else the fallback.

import { apiFetchResponse } from "./api-client";

export function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(header ?? "");
  return match?.[1] ?? fallback;
}

export async function downloadApiFile(path: string, fallbackFilename: string): Promise<void> {
  await saveResponseAsFile(await apiFetchResponse(path, { method: "GET" }), fallbackFilename);
}

/** Hands an API file response to the browser as a download. */
export async function saveResponseAsFile(response: Response, fallbackFilename: string): Promise<void> {
  const blob = await response.blob();
  const filename = filenameFromDisposition(response.headers.get("Content-Disposition"), fallbackFilename);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
