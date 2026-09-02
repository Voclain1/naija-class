import { describe, expect, it } from "vitest";

import {
  CURRICULUM_ERROR_CODES,
  checksumOf,
  looksLikePdf,
  parsePastedText,
  parseUploadedDocument,
} from "./document-parser.js";
import { makeImageOnlyPdf, makeTextPdf } from "./make-test-pdf.js";

// Phase 7 / CP2 — document parsing (D6).
//
// These run against REAL PDFs built by make-test-pdf.ts and parsed by the real
// pdf-parse, not a mock. A mocked parser would prove nothing about the two
// things that actually matter here: that the deep import works at all (the
// package's own entrypoint crashes outside a classic CJS require chain), and
// that a scan is REFUSED rather than silently ingested as an empty document.

const BODY = "Pupils should be able to state the word equation for photosynthesis. ".repeat(6);

describe("parseUploadedDocument — PDF with a text layer", () => {
  it("extracts text from a real PDF", async () => {
    const pdf = makeTextPdf([["FIRST TERM SCHEME OF WORK", "WEEK 5", BODY]]);
    const parsed = await parseUploadedDocument(pdf, "application/pdf");

    expect(parsed.kind).toBe("pdf");
    expect(parsed.text).toContain("WEEK 5");
    expect(parsed.text).toContain("word equation");
    expect(parsed.checksum).toHaveLength(64);
  });

  it("reads EVERY page, not just the first", async () => {
    const pdf = makeTextPdf([
      ["WEEK 1", BODY],
      ["WEEK 12", "Revision of all topics treated during the term. " + BODY],
    ]);
    const parsed = await parseUploadedDocument(pdf, "application/pdf");

    expect(parsed.pageCount).toBe(2);
    expect(parsed.text).toContain("WEEK 1");
    expect(parsed.text).toContain("WEEK 12");
  });

  it("REGRESSION: parsing several documents in one process does not leak text between them", async () => {
    // This is the test that disqualified pdf-parse, and it is the reason this
    // module uses pdfjs-dist. pdf-parse@1.1.1 returned the FIRST document's
    // text for every subsequent call in the same process (measured
    // 2026-09-02). In a long-lived ingestion worker that is a cross-tenant
    // content leak with no visible symptom: one school's curriculum gets
    // chunked, embedded and stored under another school's document id, and
    // every layer downstream reports success.
    //
    // Deliberately sequential in ONE process, which is exactly the shape the
    // worker runs in — a per-test fresh process would hide the bug entirely.
    const alpha = await parseUploadedDocument(
      makeTextPdf([["ALPHA SCHOOL SCHEME", `Photosynthesis. ${BODY}`]]),
      "application/pdf",
    );
    const beta = await parseUploadedDocument(
      makeTextPdf([["BETA SCHOOL SCHEME", `Simple interest. ${BODY}`]]),
      "application/pdf",
    );
    const alphaAgain = await parseUploadedDocument(
      makeTextPdf([["ALPHA SCHOOL SCHEME", `Photosynthesis. ${BODY}`]]),
      "application/pdf",
    );

    expect(alpha.text).toContain("ALPHA SCHOOL");
    expect(beta.text).toContain("BETA SCHOOL");
    expect(beta.text).not.toContain("ALPHA SCHOOL");
    expect(alphaAgain.text).not.toContain("BETA SCHOOL");
    expect(alpha.checksum).not.toBe(beta.checksum);
    expect(alpha.checksum).toBe(alphaAgain.checksum);
  });

  it("REFUSES a PDF with no text layer — the scanned-document case", async () => {
    // The single most important behaviour in this file. A scan extracts to ""
    // which is structurally a SUCCESS; without this check the teacher would see
    // their document go READY with zero chunks and get lesson plans grounded in
    // nothing, with no signal anything went wrong.
    await expect(parseUploadedDocument(makeImageOnlyPdf(), "application/pdf")).rejects.toMatchObject(
      { code: CURRICULUM_ERROR_CODES.NO_TEXT_LAYER },
    );
  });

  it("refuses a PDF carrying only scanner furniture", async () => {
    // A few characters of watermark is why the threshold is not `length === 0`.
    const pdf = makeTextPdf([["Scanned by CamScanner", "Page 1 of 12"]]);
    await expect(parseUploadedDocument(pdf, "application/pdf")).rejects.toMatchObject({
      code: CURRICULUM_ERROR_CODES.NO_TEXT_LAYER,
    });
  });

  it("reports a corrupt PDF as user-fixable, not a 500", async () => {
    const corrupt = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("not a pdf at all")]);
    await expect(parseUploadedDocument(corrupt, "application/pdf")).rejects.toMatchObject({
      code: CURRICULUM_ERROR_CODES.UNREADABLE_FILE,
    });
  });
});

describe("parseUploadedDocument — content-type is a hint, magic bytes decide", () => {
  it("parses a PDF even when the browser reported the wrong type", async () => {
    const pdf = makeTextPdf([["WEEK 5", BODY]]);
    const parsed = await parseUploadedDocument(pdf, "application/octet-stream");
    expect(parsed.kind).toBe("pdf");
  });

  it("does NOT hand a non-PDF to the PDF parser just because it claims to be one", async () => {
    // A .docx renamed to .pdf arrives as application/pdf. Trusting that would
    // feed binary garbage to the parser and produce a confusing error.
    const docxish = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00]);
    await expect(parseUploadedDocument(docxish, "application/pdf")).rejects.toMatchObject({
      code: CURRICULUM_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    });
  });

  it("accepts a plain-text file", async () => {
    const parsed = await parseUploadedDocument(Buffer.from(`WEEK 5\n${BODY}`, "utf8"), "text/plain");
    expect(parsed.kind).toBe("text");
    expect(parsed.pageCount).toBeNull();
  });

  it("rejects an empty upload", async () => {
    await expect(parseUploadedDocument(Buffer.alloc(0), "text/plain")).rejects.toMatchObject({
      code: CURRICULUM_ERROR_CODES.EMPTY_DOCUMENT,
    });
  });

  it("rejects an image outright", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    await expect(parseUploadedDocument(png, "image/png")).rejects.toMatchObject({
      code: CURRICULUM_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    });
  });
});

describe("parsePastedText — the D6 escape hatch", () => {
  it("accepts pasted text", () => {
    const parsed = parsePastedText(`  WEEK 5\n${BODY}  `);
    expect(parsed.kind).toBe("text");
    expect(parsed.text.startsWith("WEEK 5")).toBe(true);
  });

  it("rejects whitespace-only paste", () => {
    expect(() => parsePastedText("   \n\t ")).toThrowError();
  });
});

describe("checksumOf — hashes TEXT, not bytes", () => {
  it("gives the same checksum for two byte-different PDFs with identical text", async () => {
    // This is the property that makes the duplicate guard actually fire.
    // Exporting the same document twice produces byte-different PDFs (embedded
    // timestamps, object ordering); hashing bytes would mean the guard almost
    // never triggers, which is the failure that costs money.
    const a = await parseUploadedDocument(makeTextPdf([["WEEK 5", BODY]]), "application/pdf");
    const b = await parseUploadedDocument(
      Buffer.concat([makeTextPdf([["WEEK 5", BODY]]), Buffer.from("\n% trailing comment\n")]),
      "application/pdf",
    );
    expect(a.checksum).toBe(b.checksum);
  });

  it("differs when the text differs", () => {
    expect(checksumOf("week 5")).not.toBe(checksumOf("week 6"));
  });
});

describe("looksLikePdf", () => {
  it("keys off the magic bytes", () => {
    expect(looksLikePdf(Buffer.from("%PDF-1.7 ..."))).toBe(true);
    expect(looksLikePdf(Buffer.from("hello"))).toBe(false);
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
  });
});
