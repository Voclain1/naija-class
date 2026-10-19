import { PHOTO_ASPECT, PHOTO_HEIGHT_PX, PHOTO_WIDTH_PX } from "@school-kit/types";

// Cropping to passport shape (35 × 45) in the browser, so the API only ever
// receives a small JPEG of the right shape.
//
// The crop is described by `zoom` (1 = the largest passport-shaped window that
// fits the picture) and a centre point in the picture's own pixels. The pure
// functions here are tested; `encodeCrop` does the drawing.

export interface CropState {
  zoom: number;
  /** Centre of the window, in source pixels. */
  cx: number;
  cy: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MAX_ZOOM = 4;

/** The largest passport-shaped window that fits a picture, before zooming. */
export function baseWindow(srcWidth: number, srcHeight: number): { width: number; height: number } {
  if (srcWidth / srcHeight > PHOTO_ASPECT) return { width: srcHeight * PHOTO_ASPECT, height: srcHeight };
  return { width: srcWidth, height: srcWidth / PHOTO_ASPECT };
}

/** A centred crop; faces sit a little above the middle, so start slightly high. */
export function initialCrop(srcWidth: number, srcHeight: number): CropState {
  const base = baseWindow(srcWidth, srcHeight);
  const cy = Math.max(base.height / 2, Math.min(srcHeight - base.height / 2, srcHeight * 0.45));
  return { zoom: 1, cx: srcWidth / 2, cy };
}

/** The source rectangle for a crop, kept inside the picture. */
export function cropRect(srcWidth: number, srcHeight: number, crop: CropState): CropRect {
  const base = baseWindow(srcWidth, srcHeight);
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom));
  const width = base.width / zoom;
  const height = base.height / zoom;
  const x = clamp(crop.cx - width / 2, 0, srcWidth - width);
  const y = clamp(crop.cy - height / 2, 0, srcHeight - height);
  return { x, y, width, height };
}

/** Moves the window by a drag of (dx, dy) screen pixels on a preview `previewWidth` wide. */
export function panCrop(
  srcWidth: number,
  srcHeight: number,
  crop: CropState,
  dx: number,
  dy: number,
  previewWidth: number,
): CropState {
  const rect = cropRect(srcWidth, srcHeight, crop);
  const scale = rect.width / previewWidth;
  const moved = cropRect(srcWidth, srcHeight, {
    ...crop,
    cx: rect.x + rect.width / 2 - dx * scale,
    cy: rect.y + rect.height / 2 - dy * scale,
  });
  return { ...crop, cx: moved.x + moved.width / 2, cy: moved.y + moved.height / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Reads a file into an image element (any format the browser can show). */
export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not a picture this browser can open."));
    };
    img.src = url;
  });
}

/** Draws the crop at passport size and encodes it as a JPEG. */
export function encodeCrop(img: HTMLImageElement, crop: CropState): Promise<Blob> {
  const rect = cropRect(img.naturalWidth, img.naturalHeight, crop);
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_WIDTH_PX;
  canvas.height = PHOTO_HEIGHT_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This browser cannot prepare the photo."));
  // A white backing, in case the picture had transparency (a PNG).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not prepare the photo."))), "image/jpeg", 0.9);
  });
}

/**
 * The admission number a bulk-upload file is named by: the name without its
 * extension, trimmed. "SKA-0042.jpg" → "SKA-0042". Matching ignores case.
 */
export function admissionNumberFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim();
}
