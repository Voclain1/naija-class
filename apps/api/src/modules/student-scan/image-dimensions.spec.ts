import { describe, expect, it } from "vitest";

import { readImageDimensions, sniffImageMimeType } from "./image-dimensions.js";

// Pure header-parsing tests — no database, no network.
//
// These matter more than their size suggests. The dimensions this module
// returns feed the AI budget RESERVATION, which CLAUDE.md requires to happen
// before the call. A decoder that silently returns a wrong-but-plausible
// number under-reserves without ever failing, so the interesting cases here
// are the ones that produce a wrong number rather than an error: JPEG's
// variable SOF offset, and WebP's three incompatible dimension layouts.
//
// Fixtures are built byte by byte rather than checked in as binaries. A
// checked-in JPEG would be opaque — you could not tell by reading the test
// what it was meant to exercise — and this way each buffer documents the
// exact header shape it is probing.

function pngFixture(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.writeUInt32BE(13, 8); // IHDR length
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

// Builds a JPEG with `leadingSegments` placed between SOI and the SOF0 that
// carries the dimensions — standing in for the EXIF and thumbnail blocks a
// real phone photo carries.
function jpegFixture(
  width: number,
  height: number,
  leadingSegments: { marker: number; payloadLength: number }[] = [],
  sofMarker = 0xc0,
): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];

  for (const seg of leadingSegments) {
    const body = Buffer.alloc(2 + seg.payloadLength);
    body.writeUInt16BE(seg.payloadLength + 2, 0); // length includes itself
    parts.push(Buffer.from([0xff, seg.marker]), body);
  }

  const sof = Buffer.alloc(10);
  sof.writeUInt16BE(0xff00 | sofMarker, 0);
  sof.writeUInt16BE(8, 2); // segment length
  sof.writeUInt8(8, 4); // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  parts.push(sof);

  return Buffer.concat(parts);
}

function webpFixture(kind: "VP8 " | "VP8L" | "VP8X", width: number, height: number): Buffer {
  const buf = Buffer.alloc(40);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write("WEBP", 8, "ascii");
  buf.write(kind, 12, "ascii");

  if (kind === "VP8 ") {
    buf.writeUInt16LE(width & 0x3fff, 26);
    buf.writeUInt16LE(height & 0x3fff, 28);
  } else if (kind === "VP8L") {
    buf.writeUInt8(0x2f, 20);
    buf.writeUInt32LE(((height - 1) << 14) | (width - 1), 21);
  } else {
    buf.writeUIntLE(width - 1, 24, 3);
    buf.writeUIntLE(height - 1, 27, 3);
  }
  return buf;
}

describe("readImageDimensions", () => {
  it("decodes PNG dimensions from the fixed IHDR offsets", () => {
    expect(readImageDimensions(pngFixture(1920, 1080), "image/png")).toEqual({
      widthPx: 1920,
      heightPx: 1080,
    });
  });

  it("decodes a bare JPEG whose SOF0 immediately follows SOI", () => {
    expect(readImageDimensions(jpegFixture(4032, 3024), "image/jpeg")).toEqual({
      widthPx: 4032,
      heightPx: 3024,
    });
  });

  it("walks past EXIF and thumbnail segments to reach the SOF", () => {
    // The realistic case: a phone photo carries APP0 (JFIF), APP1 (EXIF,
    // often with an embedded thumbnail) and quantisation tables before the
    // frame header. A decoder that assumed a fixed offset would read two
    // bytes of EXIF as the height and return a confidently wrong number.
    const withMetadata = jpegFixture(4032, 3024, [
      { marker: 0xe0, payloadLength: 14 }, // APP0 / JFIF
      { marker: 0xe1, payloadLength: 2000 }, // APP1 / EXIF + thumbnail
      { marker: 0xdb, payloadLength: 64 }, // DQT
    ]);
    expect(readImageDimensions(withMetadata, "image/jpeg")).toEqual({
      widthPx: 4032,
      heightPx: 3024,
    });
  });

  it("treats progressive JPEG (SOF2) as a frame header", () => {
    expect(readImageDimensions(jpegFixture(1600, 1200, [], 0xc2), "image/jpeg")).toEqual({
      widthPx: 1600,
      heightPx: 1200,
    });
  });

  it("does NOT mistake a Huffman table (0xC4) for a frame header", () => {
    // 0xC4 sits inside the 0xC0-0xCF range but is DHT, not SOFn. Reading it
    // as a frame header yields a plausible-looking wrong size rather than an
    // error, which is precisely why this case is pinned: the real SOF here
    // comes after a DHT big enough to be mistaken for one.
    const withDht = jpegFixture(800, 600, [{ marker: 0xc4, payloadLength: 100 }]);
    expect(readImageDimensions(withDht, "image/jpeg")).toEqual({ widthPx: 800, heightPx: 600 });
  });

  it("gives up at SOS rather than walking compressed image data", () => {
    // Past SOS the bytes are entropy-coded and no SOF will follow. Walking
    // them as if they were segment headers is how a decoder hangs or reads
    // garbage; returning null lets the caller charge the full tier cap.
    const truncated = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0]),
      Buffer.alloc(200, 0xc0),
    ]);
    expect(readImageDimensions(truncated, "image/jpeg")).toBeNull();
  });

  it.each([
    ["VP8 ", 1024, 768],
    ["VP8L", 1024, 768],
    ["VP8X", 1024, 768],
  ] as const)("decodes WebP %s dimensions", (kind, w, h) => {
    expect(readImageDimensions(webpFixture(kind, w, h), "image/webp")).toEqual({
      widthPx: w,
      heightPx: h,
    });
  });

  it("returns null rather than throwing on a truncated or malformed header", () => {
    // The caller's null branch charges the model's full visual-token cap, so
    // this degrades to a pessimistic reservation instead of a failed scan.
    expect(readImageDimensions(Buffer.alloc(3), "image/png")).toBeNull();
    expect(readImageDimensions(Buffer.from("not an image at all"), "image/jpeg")).toBeNull();
    expect(readImageDimensions(Buffer.alloc(0), "image/webp")).toBeNull();
  });

  it("rejects a header that parses but yields nonsense dimensions", () => {
    // Zero must not reach the token estimator as a real value — it would
    // price the image at nothing, which is the under-reservation this whole
    // module exists to prevent.
    expect(readImageDimensions(pngFixture(0, 1080), "image/png")).toBeNull();
    expect(readImageDimensions(pngFixture(1920, 0), "image/png")).toBeNull();
  });
});

describe("sniffImageMimeType", () => {
  it("identifies each accepted format from its magic bytes", () => {
    expect(sniffImageMimeType(pngFixture(10, 10))).toBe("image/png");
    expect(sniffImageMimeType(jpegFixture(10, 10))).toBe("image/jpeg");
    expect(sniffImageMimeType(webpFixture("VP8 ", 10, 10))).toBe("image/webp");
  });

  it("rejects a non-image payload regardless of what the upload claimed", () => {
    // The multipart Content-Type is client-supplied and therefore not
    // evidence. This payload goes to a third party, so a file that CLAIMS to
    // be a JPEG and is not must be stopped here.
    expect(sniffImageMimeType(Buffer.from("%PDF-1.7\n%âãÏÓ"))).toBeNull();
    expect(sniffImageMimeType(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull();
  });
});
