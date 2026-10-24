import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { WEBSITE_LIMITS } from "@school-kit/types";

import { fitWithin } from "./website";

// A website photo is two JPEGs: 1600 px on the long side, and a 480 px
// thumbnail (docs/modules/school-website.md). The web editor makes them in the
// browser; the app makes them here, on the phone. Re-encoding writes a new
// JPEG with none of the original's data, so the phone's location (EXIF) never
// reaches the public page, as on the web.

export interface PreparedWebsitePhoto {
  largeUri: string;
  thumbBase64: string;
}

async function encode(uri: string, width: number, height: number, max: number, compress: number, base64: boolean) {
  const size = fitWithin(width, height, max);
  const image = await ImageManipulator.manipulate(uri).resize(size).renderAsync();
  try {
    return await image.saveAsync({ format: SaveFormat.JPEG, compress, base64 });
  } finally {
    image.release();
  }
}

async function bytesOf(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? info.size : 0;
}

/** The two JPEGs the API takes, from a photo the picker returned. Same quality steps as the web. */
export async function prepareWebsitePhoto(asset: { uri: string; width: number; height: number }): Promise<PreparedWebsitePhoto> {
  let large = await encode(asset.uri, asset.width, asset.height, WEBSITE_LIMITS.largeSide, 0.85, false);
  if ((await bytesOf(large.uri)) > WEBSITE_LIMITS.photoBytes) {
    large = await encode(asset.uri, asset.width, asset.height, WEBSITE_LIMITS.largeSide, 0.7, false);
  }
  const thumb = await encode(asset.uri, asset.width, asset.height, WEBSITE_LIMITS.thumbSide, 0.8, true);
  if (!thumb.base64) throw new Error("Could not prepare the photo.");
  return { largeUri: large.uri, thumbBase64: thumb.base64 };
}
