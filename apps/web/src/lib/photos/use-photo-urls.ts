"use client";

import { useEffect, useMemo, useState } from "react";

import { staffPhotoUrls, studentPhotoUrls } from "./photos-api";

// Signed photo links, asked for in batches of up to 200 and remembered for
// most of their hour, so a roster costs one request and moving between pages
// costs none. An upload or removal calls `forgetPhoto`, which tells every
// mounted hook to ask again.

export type PhotoKind = "student" | "staff";

const TTL_MS = 50 * 60 * 1000;
const BATCH = 200;
const CHANGED_EVENT = "schoolkit:photo-changed";

const cache: Record<PhotoKind, Map<string, { url: string | null; at: number }>> = {
  student: new Map(),
  staff: new Map(),
};

/** Drops a cached link after an upload or removal, so it is fetched again. */
export function forgetPhoto(kind: PhotoKind, id: string) {
  cache[kind].delete(id);
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

function fresh(kind: PhotoKind, id: string) {
  const hit = cache[kind].get(id);
  return hit && Date.now() - hit.at < TTL_MS ? hit : null;
}

async function fetchMissing(kind: PhotoKind, ids: string[]): Promise<void> {
  const missing = ids.filter((id) => !fresh(kind, id));
  for (let i = 0; i < missing.length; i += BATCH) {
    const chunk = missing.slice(i, i + BATCH);
    const { urls } = await (kind === "student" ? studentPhotoUrls(chunk) : staffPhotoUrls(chunk));
    const at = Date.now();
    for (const id of chunk) cache[kind].set(id, { url: urls[id] ?? null, at });
  }
}

/**
 * Links for the people in `ids` who have a photo. Pass only ids whose record
 * says `hasPhoto`, so a class without photos costs nothing.
 */
export function usePhotoUrls(kind: PhotoKind, ids: string[]): Record<string, string> {
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(CHANGED_EVENT, bump);
    return () => window.removeEventListener(CHANGED_EVENT, bump);
  }, []);

  useEffect(() => {
    const list = key ? key.split(",") : [];
    if (list.length === 0) {
      setUrls({});
      return;
    }
    let live = true;
    const read = () => {
      const out: Record<string, string> = {};
      for (const id of list) {
        const url = fresh(kind, id)?.url;
        if (url) out[id] = url;
      }
      return out;
    };
    setUrls(read());
    fetchMissing(kind, list)
      .then(() => {
        if (live) setUrls(read());
      })
      .catch(() => {
        // A photo is decoration here: initials show instead.
      });
    return () => {
      live = false;
    };
  }, [kind, key, version]);

  return urls;
}
