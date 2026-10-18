"use client";

// Phase 9 / CP8.2 — photos on a message (docs/modules/phase-9.md §17.10).
// Each photo is shrunk in the browser (longest side 1600 px, JPEG) before it
// is sent: a phone photo is often 3-8 MB, and the portal's server passes a
// request on only up to 4.5 MB. Then it is staged on its own and named on the
// message. Up to 3 a message.

import { useState } from "react";

import { MESSAGE_LIMITS, type MessageImageDto, type StagedMessageImageDto } from "@school-kit/types";

const MAX_SIDE = 1600;
/** Under the proxy's 4.5 MB cap, with room for the multipart wrapping. */
const MAX_SENT_BYTES = 4 * 1024 * 1024;

export interface PickedPhoto {
  id: string;
  name: string;
}

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  for (const [side, quality] of [
    [MAX_SIDE, 0.82],
    [1200, 0.7],
    [900, 0.6],
  ] as const) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_SENT_BYTES) return blob;
  }
  throw new Error("too large");
}

async function stage(file: File): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  let blob: Blob;
  try {
    blob = await shrink(file);
  } catch {
    return { ok: false, message: `${file.name} could not be read as a photo. Choose a JPEG, PNG or WebP.` };
  }
  const form = new FormData();
  form.append("file", blob, "photo.jpg");
  try {
    const res = await fetch("/api/portal/messages/images", { method: "POST", body: form });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (body as { error?: { message?: string } } | null)?.error?.message ?? "The photo could not be added.";
      return { ok: false, message };
    }
    return { ok: true, id: (body as StagedMessageImageDto).id };
  } catch {
    return { ok: false, message: "Could not reach the server. Try again in a moment." };
  }
}

export function PhotoPicker({ photos, onChange, onError }: { photos: PickedPhoto[]; onChange: (p: PickedPhoto[]) => void; onError: (m: string) => void }) {
  const [adding, setAdding] = useState(false);

  async function add(files: FileList | null) {
    if (!files) return;
    setAdding(true);
    let next = photos;
    for (const file of Array.from(files).slice(0, MESSAGE_LIMITS.images - photos.length)) {
      const r = await stage(file);
      if (r.ok) {
        next = [...next, { id: r.id, name: file.name }];
        onChange(next);
      } else onError(r.message);
    }
    setAdding(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {photos.map((p) => (
        <span key={p.id} className="flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
          <span className="truncate">{p.name}</span>
          <button type="button" aria-label={`Remove ${p.name}`} className="text-muted-foreground" onClick={() => onChange(photos.filter((x) => x.id !== p.id))}>
            ×
          </button>
        </span>
      ))}
      {photos.length < MESSAGE_LIMITS.images && (
        <label className="cursor-pointer font-medium text-primary hover:underline">
          {adding ? "Adding photo…" : "Add photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            disabled={adding}
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}
      <span className="text-xs text-muted-foreground">Up to {MESSAGE_LIMITS.images} photos.</span>
    </div>
  );
}

/** A message's photos, each opening full size (a 5-minute link). */
export function MessagePhotos({ images }: { images: MessageImageDto[] }) {
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img, i) => (
        <a key={img.id} href={img.url} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived private link */}
          <img src={img.url} alt={`Photo ${i + 1}`} className="h-28 w-28 rounded-md object-cover" />
        </a>
      ))}
    </div>
  );
}
