import { WEBSITE_LIMITS } from "@school-kit/types";

import { loadImage } from "@/lib/photos/crop";

// Website photos are resized in the browser before upload
// (docs/modules/school-website.md): a large copy, 1600 px on its long side,
// and a 480 px thumbnail, both JPEG. Re-encoding through a canvas also drops
// the file's own data, including where it was taken (EXIF), so a phone's GPS
// position never reaches the public page.

/** The size an image of w × h becomes when its long side is at most `max`. Never enlarged. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function encode(img: HTMLImageElement, max: number, quality: number): Promise<Blob> {
  const size = fitWithin(img.naturalWidth, img.naturalHeight, max);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This browser cannot prepare the photo."));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, size.width, size.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not prepare the photo."))), "image/jpeg", quality);
  });
}

/** The two JPEGs the API takes for one website photo. */
export async function prepareWebsitePhoto(file: File): Promise<{ large: Blob; thumb: Blob }> {
  const img = await loadImage(file);
  let large = await encode(img, WEBSITE_LIMITS.largeSide, 0.85);
  if (large.size > WEBSITE_LIMITS.photoBytes) large = await encode(img, WEBSITE_LIMITS.largeSide, 0.7);
  const thumb = await encode(img, WEBSITE_LIMITS.thumbSide, 0.8);
  return { large, thumb };
}
