"use client";

import { Loader2, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_ZOOM, cropRect, encodeCrop, initialCrop, loadImage, panCrop, type CropState } from "@/lib/photos/crop";

// Crop a chosen picture to passport shape (35 × 45) before it is sent:
// drag to move, the slider to zoom. The preview is exactly what is saved.

const PREVIEW_W = 210;
const PREVIEW_H = 270;

export function PhotoCropDialog({
  file,
  title,
  onCancel,
  onSave,
}: {
  file: File | null;
  title: string;
  onCancel: () => void;
  onSave: (jpeg: Blob) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<CropState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setImg(null);
    setCrop(null);
    setError(null);
    if (!file) return;
    let live = true;
    loadImage(file)
      .then((loaded) => {
        if (!live) return;
        setImg(loaded);
        setCrop(initialCrop(loaded.naturalWidth, loaded.naturalHeight));
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img || !crop) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const r = cropRect(img.naturalWidth, img.naturalHeight, crop);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    ctx.drawImage(img, r.x, r.y, r.width, r.height, 0, 0, PREVIEW_W, PREVIEW_H);
  }, [img, crop]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current || !img || !crop) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setCrop(panCrop(img.naturalWidth, img.naturalHeight, crop, dx, dy, PREVIEW_W));
  }

  async function save() {
    if (!img || !crop) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await encodeCrop(img, crop));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the photo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={file !== null} onOpenChange={(next) => !next && !saving && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Drag the picture to place the face in the frame, and zoom if needed.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          {img && crop ? (
            <canvas
              ref={canvasRef}
              width={PREVIEW_W}
              height={PREVIEW_H}
              aria-label="Photo preview"
              className="cursor-move touch-none rounded-md border bg-white"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            />
          ) : (
            !error && (
              <div className="flex h-[270px] w-[210px] items-center justify-center rounded-md border text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )
          )}
          {crop && (
            <label className="flex w-full items-center gap-2 text-sm">
              <ZoomIn className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="sr-only">Zoom</span>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.05}
                value={crop.zoom}
                onChange={(e) => setCrop({ ...crop, zoom: Number(e.target.value) })}
                className="flex-1"
              />
            </label>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!crop || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
