import { describe, expect, it } from "vitest";

import { assertPrivateFile, PRIVATE_FILE_MAX_BYTES, sniffPrivateFile } from "./private-file";
import { pathFor } from "./storage.utils";

// F1 — the type comes from the bytes, never the name or declared type.
describe("private files (F1)", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
  const pdf = Buffer.from("%PDF-1.7\n");

  it("recognises JPEG, PNG, WebP and PDF by their first bytes", () => {
    expect(sniffPrivateFile(jpeg)?.ext).toBe("jpg");
    expect(sniffPrivateFile(png)?.ext).toBe("png");
    expect(sniffPrivateFile(webp)?.ext).toBe("webp");
    expect(sniffPrivateFile(pdf)?.mime).toBe("application/pdf");
  });

  it("refuses anything else, an empty file, and a file over 10 MB", () => {
    expect(() => assertPrivateFile(Buffer.from("MZ\x90\x00 not an image"))).toThrow(/photo|PDF/);
    expect(() => assertPrivateFile(Buffer.from("<html><script>"))).toThrow();
    expect(() => assertPrivateFile(Buffer.alloc(0))).toThrow(/empty/);
    const big = Buffer.concat([pdf, Buffer.alloc(PRIVATE_FILE_MAX_BYTES)]);
    expect(() => assertPrivateFile(big)).toThrow(/10 MB/);
  });

  it("lays a health document out under the school, by id and real extension", () => {
    const school = "11111111-1111-4111-8111-111111111111";
    const doc = "22222222-2222-4222-8222-222222222222";
    expect(pathFor(school, { kind: "health-document", documentId: doc, ext: "pdf" })).toBe(
      `schools/${school}/health/${doc}.pdf`,
    );
    expect(() => pathFor(school, { kind: "health-document", documentId: "../x", ext: "pdf" })).toThrow();
  });
});
