"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { WEBSITE_LIMITS, type SchoolWebsiteDto, type WebsiteAlbumDto, type WebsitePhotoDto } from "@school-kit/types";

import { SELECT_CLASSES } from "@/components/transport/term-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import {
  createWebsiteAlbum,
  deleteWebsiteAlbum,
  deleteWebsitePhoto,
  listWebsitePhotos,
  updateWebsitePhoto,
} from "@/lib/school-website/school-website-api";

import { SectionLock } from "./section-lock";
import { WebsitePhotoUpload } from "./website-photo-upload";

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

// The photo gallery (docs/modules/school-website.md): photos, captions and
// optional albums. No pupils (W4).
export function WebsiteGalleryPanel({ site, onChanged }: { site: SchoolWebsiteDto; onChanged: () => void }) {
  const [photos, setPhotos] = useState<WebsitePhotoDto[] | null>(null);
  const [albums, setAlbums] = useState<WebsiteAlbumDto[]>([]);
  const [albumTitle, setAlbumTitle] = useState("");
  const [uploadAlbum, setUploadAlbum] = useState("");
  const state = site.sections.find((s) => s.section === "gallery")!;
  const cap = site.limits.galleryPhotos;

  async function load() {
    const list = await listWebsitePhotos("GALLERY");
    setPhotos(list.photos);
    setAlbums(list.albums);
  }

  useEffect(() => {
    load().catch(() => setPhotos([]));
  }, []);

  async function run(fn: () => Promise<void>) {
    try {
      await fn();
      onChanged();
    } catch (e) {
      toast.error(message(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionLock state={state} enforcement={site.enforcement} />
      <p className="text-sm text-muted-foreground">
        {photos?.length ?? 0} of {cap || WEBSITE_LIMITS.galleryPhotos} photos.
      </p>

      <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
        <h3 className="font-semibold">Albums</h3>
        <div className="flex flex-wrap gap-2">
          {albums.map((a) => (
            <span key={a.id} className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm">
              {a.title} ({a.photoCount})
              <button
                type="button"
                aria-label={`Delete the album ${a.title}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (!window.confirm(`Delete the album “${a.title}”? Its photos stay in the gallery.`)) return;
                  void run(async () => {
                    await deleteWebsiteAlbum(a.id);
                    await load();
                  });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {albums.length === 0 && <span className="text-sm text-muted-foreground">No albums. Photos show together.</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs" aria-label="New album name" placeholder="e.g. Inter-house sports 2026" maxLength={WEBSITE_LIMITS.albumTitle} value={albumTitle} onChange={(e) => setAlbumTitle(e.target.value)} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!albumTitle.trim()}
            onClick={() =>
              void run(async () => {
                const a = await createWebsiteAlbum(albumTitle.trim());
                setAlbums((prev) => [...prev, a]);
                setAlbumTitle("");
              })
            }
          >
            Add album
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {albums.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Add to album</span>
            <select className={SELECT_CLASSES} value={uploadAlbum} onChange={(e) => setUploadAlbum(e.target.value)}>
              <option value="">No album</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <WebsitePhotoUpload
          kind="GALLERY"
          albumId={uploadAlbum || undefined}
          label="Add to the gallery"
          onUploaded={(p) => {
            setPhotos((prev) => [p, ...(prev ?? [])]);
            onChanged();
          }}
        />
      </div>

      {photos === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id} className={`flex flex-col gap-1 rounded-md p-2 ${p.takenDown ? "bg-amber-50 dark:bg-amber-950/30" : "bg-card"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL */}
              <img src={p.thumbUrl} alt={p.caption ?? ""} className={`aspect-[4/3] w-full rounded object-cover ${p.takenDown ? "opacity-40" : ""}`} />
              {p.takenDown ? (
                <p className="text-xs text-amber-900 dark:text-amber-200">Taken down by SchoolKit: {p.takenDown.reason}</p>
              ) : (
                <>
                  <Input
                    aria-label="Caption"
                    placeholder="Caption"
                    maxLength={WEBSITE_LIMITS.caption}
                    defaultValue={p.caption ?? ""}
                    onBlur={(e) => {
                      const caption = e.target.value.trim();
                      if (caption === (p.caption ?? "")) return;
                      void run(async () => {
                        const next = await updateWebsitePhoto(p.id, { caption: caption || null });
                        setPhotos((prev) => (prev ?? []).map((x) => (x.id === p.id ? next : x)));
                      });
                    }}
                  />
                  {albums.length > 0 && (
                    <select
                      aria-label="Album"
                      className={SELECT_CLASSES}
                      value={p.albumId ?? ""}
                      onChange={(e) =>
                        void run(async () => {
                          const next = await updateWebsitePhoto(p.id, { albumId: e.target.value || null });
                          setPhotos((prev) => (prev ?? []).map((x) => (x.id === p.id ? next : x)));
                        })
                      }
                    >
                      <option value="">No album</option>
                      {albums.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  if (!window.confirm("Delete this photo?")) return;
                  void run(async () => {
                    await deleteWebsitePhoto(p.id);
                    setPhotos((prev) => (prev ?? []).filter((x) => x.id !== p.id));
                  });
                }}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
