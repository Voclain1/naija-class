// Pixel-dimension decoding for the three image formats Smart Student Import
// accepts, by parsing file headers directly.
//
// WHY THIS EXISTS AT ALL, rather than being skipped: the AI budget
// reservation runs BEFORE the call (CLAUDE.md's AI hard rule) and prices an
// image at ceil(w/28) * ceil(h/28) visual tokens. Without real dimensions the
// reservation cannot price the largest input in the request, and a school
// near its cap would overshoot it. See smart-student-import.md §2.
//
// WHY NO DEPENDENCY: `sharp` and friends carry native binaries, and the
// deployed API runs in a Fly container whose Dockerfile is already a known
// sore point in this project (see the Chromium provisioning item in
// docs/deferred.md). Adding a native module to read four integers out of a
// header would be a deployment risk taken for no benefit — we do not resize,
// re-encode or inspect pixels, and the API downsizes server-side anyway.
//
// FAILURE MODE IS DELIBERATE: every function here returns null rather than
// throwing on a malformed header, and the caller charges the model's full
// visual-token cap when it gets null. That is the safe direction — an
// unparseable header over-reserves rather than under-reserves — and it means
// an exotic-but-valid JPEG variant degrades to a slightly pessimistic
// reservation instead of a failed scan.

export interface ImageDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
}

// PNG: an 8-byte signature, then the IHDR chunk whose first two big-endian
// uint32s are width and height at fixed offsets 16 and 20. Fixed layout —
// IHDR is required by the spec to be the first chunk.
function decodePng(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { widthPx: buf.readUInt32BE(16), heightPx: buf.readUInt32BE(20) };
}

// JPEG: a marker-segment walk. Dimensions live in the Start-Of-Frame marker,
// whose position is NOT fixed — a phone photo carries EXIF, and often a
// thumbnail, ahead of it, so the offset varies per file and per camera.
//
// The SOFn markers are 0xC0-0xCF EXCLUDING 0xC4 (Huffman table), 0xC8
// (reserved) and 0xCC (arithmetic coding conditioning). Those three share the
// numeric range but are not frame headers, and treating one as a frame header
// reads two unrelated bytes as a height — which is exactly the sort of bug
// that yields a plausible-looking wrong number rather than an error.
function decodeJpeg(buf: Buffer): ImageDimensions | null {
  if (buf.length < 4) return null;
  if (buf.readUInt16BE(0) !== 0xffd8) return null; // SOI

  let offset = 2;
  while (offset + 9 < buf.length) {
    // Segments begin with 0xFF. Fill bytes (repeated 0xFF) are legal padding
    // between segments, so skip them rather than treating one as corruption.
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }

    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      // SOF payload: length(2) precision(1) height(2) width(2)
      return {
        heightPx: buf.readUInt16BE(offset + 5),
        widthPx: buf.readUInt16BE(offset + 7),
      };
    }

    // Standalone markers carry no length field; everything else does.
    // SOS (0xDA) means entropy-coded image data follows and no SOF will
    // appear after it — give up rather than walking compressed bytes as if
    // they were segment headers.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) return null;

    const segmentLength = buf.readUInt16BE(offset + 2);
    // A length below 2 cannot include its own length field — the file is
    // malformed and continuing would loop forever or walk off the end.
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

// WebP: a RIFF container. Bytes 0-3 "RIFF", 8-11 "WEBP", then a chunk whose
// FourCC selects one of three encodings with entirely different dimension
// layouts. All three are handled because a phone's "WebP" output is not a
// single format — VP8L in particular packs 14-bit dimensions into a bit
// field, so reading it as VP8's little-endian uint16 would be silently wrong.
function decodeWebp(buf: Buffer): ImageDimensions | null {
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }

  const format = buf.toString("ascii", 12, 16);

  if (format === "VP8 ") {
    // Lossy. 3-byte frame tag, 3-byte start code, then 14-bit width/height
    // each followed by a 2-bit scale factor which we discard.
    return {
      widthPx: buf.readUInt16LE(26) & 0x3fff,
      heightPx: buf.readUInt16LE(28) & 0x3fff,
    };
  }

  if (format === "VP8L") {
    // Lossless. One signature byte (0x2F), then 28 bits: 14 width-1 and 14
    // height-1, little-endian bit order.
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return {
      widthPx: (bits & 0x3fff) + 1,
      heightPx: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (format === "VP8X") {
    // Extended. Canvas size as two 24-bit little-endian values, each minus 1.
    const width = buf.readUIntLE(24, 3) + 1;
    const height = buf.readUIntLE(27, 3) + 1;
    return { widthPx: width, heightPx: height };
  }

  return null;
}

// Returns null when the header cannot be parsed. Callers must treat null as
// "charge the full tier cap", never as "charge nothing".
export function readImageDimensions(buf: Buffer, mimeType: string): ImageDimensions | null {
  let dims: ImageDimensions | null = null;
  if (mimeType === "image/png") dims = decodePng(buf);
  else if (mimeType === "image/jpeg") dims = decodeJpeg(buf);
  else if (mimeType === "image/webp") dims = decodeWebp(buf);

  if (!dims) return null;
  // A zero or absurd dimension means the header parsed but produced nonsense
  // — reject it here so the caller's null branch handles it uniformly rather
  // than reserving zero tokens for a "0x0" image.
  if (dims.widthPx <= 0 || dims.heightPx <= 0) return null;
  if (dims.widthPx > 65535 || dims.heightPx > 65535) return null;
  return dims;
}

// Content-type sniffing from magic bytes, independent of the multipart
// Content-Type header.
//
// The header is client-supplied and therefore not evidence: a browser will
// happily label anything, and this endpoint hands its payload to a third
// party. Checking the actual bytes means a file that claims to be a JPEG and
// is not gets rejected here rather than producing a confusing 400 from the
// Anthropic API — and it closes the gap where a declared-JPEG/actual-PNG
// would be sent with the wrong `media_type`.
export function sniffImageMimeType(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  return null;
}
