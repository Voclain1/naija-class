"use client";

import { Camera, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  removeOwnPhoto,
  removeStaffPhoto,
  removeStudentPhoto,
  uploadOwnPhoto,
  uploadStaffPhoto,
  uploadStudentPhoto,
} from "@/lib/photos/photos-api";
import { forgetPhoto, usePhotoUrls, type PhotoKind } from "@/lib/photos/use-photo-urls";

import { PhotoCropDialog } from "./photo-crop-dialog";

// A person's passport photo with Upload / Change / Remove (2026-10-19,
// docs/modules/id-cards-and-store.md §2). The picture can be any format the
// browser opens; it is cropped and sent as a JPEG.

export function PhotoField({
  kind,
  id,
  name,
  hasPhoto,
  canEdit,
  own = false,
  onChange,
}: {
  kind: PhotoKind;
  id: string;
  name: string;
  hasPhoto: boolean;
  canEdit: boolean;
  /** The signed-in person's own photo (uses the /me routes). */
  own?: boolean;
  onChange?: (hasPhoto: boolean) => void;
}) {
  const urls = usePhotoUrls(kind, hasPhoto ? [id] : []);
  const url = hasPhoto ? urls[id] : undefined;
  const [file, setFile] = useState<File | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function save(jpeg: Blob) {
    try {
      if (kind === "student") await uploadStudentPhoto(id, jpeg);
      else if (own) await uploadOwnPhoto(jpeg);
      else await uploadStaffPhoto(id, jpeg);
    } catch (e) {
      throw new Error(e instanceof ApiError ? e.message : "Could not save the photo.");
    }
    forgetPhoto(kind, id);
    setFile(null);
    onChange?.(true);
  }

  async function remove() {
    if (!window.confirm(`Remove ${name}'s photo?`)) return;
    setRemoving(true);
    setError(null);
    try {
      if (kind === "student") await removeStudentPhoto(id);
      else if (own) await removeOwnPhoto();
      else await removeStaffPhoto(id);
      forgetPhoto(kind, id);
      onChange?.(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not remove the photo.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived link
        <img src={url} alt={`Photo of ${name}`} className="h-[90px] w-[70px] shrink-0 rounded-md border object-cover" />
      ) : (
        <div className="flex h-[90px] w-[70px] shrink-0 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
          {hasPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : "No photo"}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
              <Camera className="h-4 w-4" />
              {hasPhoto ? "Change photo" : "Upload photo"}
            </Button>
            {hasPhoto && (
              <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={removing}>
                {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">A clear, recent passport photo. You can crop it before saving.</p>
          <input
            ref={input}
            type="file"
            accept="image/*"
            aria-label={`Choose a photo of ${name}`}
            className="sr-only"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
      <PhotoCropDialog file={file} title={`Photo of ${name}`} onCancel={() => setFile(null)} onSave={save} />
    </div>
  );
}
