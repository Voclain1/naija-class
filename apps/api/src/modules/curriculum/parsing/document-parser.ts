// Phase 7 / CP2 — document parsing (D6).
//
// v1 accepts exactly two things: a PDF WITH A TEXT LAYER, and pasted plain
// text. Scanned or photographed documents are explicitly deferred, and the
// most important behaviour in this file is that they are REFUSED CLEARLY
// rather than accepted and silently ingested as an empty document.
//
// That distinction is the whole point. A scan run through a text extractor
// yields "" — structurally a success. Without the check below, a teacher would
// upload their scheme of work, see it go READY with zero chunks, and get
// lesson plans grounded in nothing, with no signal that anything went wrong.
// An error naming the actual problem ("this looks like a scan") is worth more
// than any amount of downstream robustness.
//
// -- WHY pdfjs-dist AND NOT pdf-parse ---------------------------------------
// `pdf-parse` is the obvious choice for this job and it was tried first. It is
// DISQUALIFIED, on evidence, and must not be reintroduced:
//
//   pdf-parse@1.1.1 returns the FIRST document's text for every subsequent
//   call in the same process.
//
// Measured 2026-09-02 by parsing three different PDFs in sequence — A, B, then
// an empty one — and getting A's text back all three times, in both orders.
// The cause is its pinned pdf.js v1.10.100 build (`PDFJS.getDocument` on the
// fake-worker path, with the module cached in a file-level `var PDFJS`).
//
// In a long-lived ingestion worker that is not a quirk, it is a CROSS-TENANT
// CONTENT LEAK: the first school's scheme of work would be chunked, embedded
// and stored under the next school's document id, and every symptom would look
// like a working system. Nothing downstream could detect it — the text parses,
// the chunks embed, retrieval returns confident results from the wrong
// school's curriculum.
//
// pdfjs-dist is Mozilla's maintained build, creates a real per-call document,
// and is explicitly destroyed below. document-parser.spec.ts carries a
// regression test that parses two different PDFs in one process and asserts
// their text differs — the test that would have caught this immediately.

import { createHash } from "node:crypto";
import { dirname, join, sep } from "node:path";

import { ValidationError } from "@school-kit/types";

// -- LOADING AN ESM-ONLY PACKAGE FROM THIS COMMONJS APP ---------------------
// apps/api compiles to CommonJS (packages/config/tsconfig.node.json sets
// `module: CommonJS`, as NestJS's decorator metadata requires), and
// pdfjs-dist@4 is ESM-only — its package.json `main` is `build/pdf.mjs` and
// there is no CJS build.
//
// A plain `await import("...")` does NOT work here: TypeScript downlevels
// dynamic import to `Promise.resolve().then(() => require(...))` under
// `module: CommonJS`, and `require` cannot load an `.mjs` file. The failure is
// especially nasty because VITEST DOES NOT REPRODUCE IT — its SWC pipeline
// handles ESM natively, so the specs pass while the built API throws
// ERR_REQUIRE_ESM on the first upload. Exactly the class of gap CLAUDE.md's
// "ESM module resolution" section warns about, in the opposite direction.
//
// `new Function` produces a genuine dynamic import that survives
// transpilation. It is the standard CJS→ESM bridge.
//
// BUT IT DOES NOT WORK UNDER VITEST: the spec runner evaluates modules in a VM
// context with no `importModuleDynamically` callback, so a Function-built
// `import()` throws "A dynamic import callback was not specified". Meanwhile a
// plain `await import()` works under Vitest and fails in the compiled CJS
// bundle. Neither loader works in both places, so BOTH are here, in the order
// that puts production first:
//
//   1. the Function bridge — the path the shipped, compiled API takes;
//   2. a plain dynamic import — the path Vitest takes.
//
// This is not defensive coding for its own sake. It is two genuinely different
// module systems needing two genuinely different loaders, and the pairing is
// what lets the specs and the deployed binary exercise the same source file.
// Verified in both: `pnpm test` here, and a require() of dist/ in CP2's
// close-out.
//
// Alternative considered and rejected: pdfjs-dist@3, which does ship a CJS
// build — but it drags in `canvas`, a native node-gyp dependency that already
// failed to build locally and would run on every Fly Docker deploy for a
// feature that never rasterises a page.
type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

const importEsmViaFunction = new Function("specifier", "return import(specifier)") as (
  specifier: string,
) => Promise<PdfjsModule>;

async function importEsm(specifier: string): Promise<PdfjsModule> {
  try {
    return await importEsmViaFunction(specifier);
  } catch (err) {
    // Only Vitest's VM should reach here. Anything else rethrows below if the
    // second attempt also fails, so a genuine load error is not swallowed.
    if (!/dynamic import callback was not specified/i.test(String(err))) throw err;
    return (await import(specifier)) as PdfjsModule;
  }
}

/**
 * Filesystem path of pdfjs-dist's bundled standard fonts, with a trailing
 * separator (pdf.js concatenates a filename onto it).
 *
 * A PLAIN PATH, not a file:// URL. pdf.js's Node font factory reads this with
 * `fs`, and Node's `fetch` does not support the file: scheme — passing a URL
 * produced "Unable to load font data" for every document, which is a warning
 * rather than an error and so would have gone unnoticed indefinitely.
 *
 * `require.resolve` rather than a relative path because node_modules layout
 * differs between the pnpm store, a Docker image and a bundled build. Plain
 * `require` is available because this module compiles to CommonJS — see the
 * note above.
 */
let cachedFontPath: string | undefined;
function standardFontDataUrl(): string {
  if (cachedFontPath === undefined) {
    const pkg = require.resolve("pdfjs-dist/package.json");
    cachedFontPath = join(dirname(pkg), "standard_fonts") + sep;
  }
  return cachedFontPath;
}

export const CURRICULUM_ERROR_CODES = {
  UNSUPPORTED_FILE_TYPE: "CURRICULUM_UNSUPPORTED_FILE_TYPE",
  NO_TEXT_LAYER: "CURRICULUM_NO_TEXT_LAYER",
  EMPTY_DOCUMENT: "CURRICULUM_EMPTY_DOCUMENT",
  UNREADABLE_FILE: "CURRICULUM_UNREADABLE_FILE",
} as const;

/**
 * Below this many characters of extracted text, a PDF is treated as having no
 * usable text layer.
 *
 * Not zero, deliberately: scanners and phone-scanning apps routinely stamp a
 * few characters of furniture onto an otherwise imaged page — a page number, a
 * "Scanned by ..." watermark, a date. A strict `length === 0` test would let
 * those through as "successfully parsed" documents containing nothing but the
 * watermark. 200 characters is far below any real page of a scheme of work and
 * far above that furniture.
 */
export const MIN_TEXT_LAYER_CHARS = 200;

export type CurriculumSourceKind = "pdf" | "text";

export interface ParsedDocument {
  readonly text: string;
  readonly kind: CurriculumSourceKind;
  /** Pages, where the format has them. Null for pasted text. */
  readonly pageCount: number | null;
  /** SHA-256 of the EXTRACTED TEXT — see checksumOf. */
  readonly checksum: string;
}

/**
 * Checksum of the extracted text, NOT of the uploaded bytes.
 *
 * This is what guards against re-embedding an identical re-upload, and text is
 * the right thing to hash for that: exporting the same document twice produces
 * byte-different PDFs (embedded timestamps, object ordering) while the text is
 * identical. Hashing bytes would make the guard almost never fire — which is
 * the failure that costs money, since the whole point is to avoid paying to
 * embed the same content twice.
 */
export function checksumOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const PDF_MAGIC = Buffer.from("%PDF-");

/** True when the buffer actually starts with a PDF header. */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

/**
 * Parse an uploaded file into text.
 *
 * Content type is taken as a HINT only and the magic bytes decide, because a
 * browser's reported mimetype is attacker- and accident-controlled: a `.pdf`
 * renamed from `.docx` arrives as application/pdf and would otherwise reach
 * the PDF parser as garbage.
 */
export async function parseUploadedDocument(
  buffer: Buffer,
  contentType: string | null,
): Promise<ParsedDocument> {
  if (buffer.length === 0) {
    throw new ValidationError(
      CURRICULUM_ERROR_CODES.EMPTY_DOCUMENT,
      "The uploaded file is empty.",
    );
  }

  if (looksLikePdf(buffer)) return parsePdf(buffer);

  // Plain text, uploaded as a file rather than pasted.
  if (isProbablyText(buffer, contentType)) {
    const text = buffer.toString("utf8");
    return finishText(text, "text", null);
  }

  throw new ValidationError(
    CURRICULUM_ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    "Only PDF files with selectable text, or plain text, can be uploaded. " +
      "Word documents should be exported to PDF first; scanned or photographed " +
      "pages are not supported yet — paste the text instead.",
  );
}

/** Parse text the teacher pasted into the form. */
export function parsePastedText(raw: string): ParsedDocument {
  return finishText(raw, "text", null);
}

async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  // Imported lazily so the ~10 MB pdf.js bundle is not loaded at API boot for
  // the many processes that never parse a PDF — and through importEsm, for the
  // CommonJS reason documented at the top of this file.
  const { getDocument } = await importEsm("pdfjs-dist/legacy/build/pdf.mjs");

  let text: string;
  let pageCount: number;
  try {
    const task = getDocument({
      // A COPY: pdf.js takes ownership of the array it is given and may detach
      // the underlying buffer, which would corrupt the caller's Buffer — the
      // same bytes we are about to persist to storage.
      data: new Uint8Array(buffer),
      // A curriculum PDF is untrusted input from the internet. Turn off every
      // feature that executes or fetches anything: no embedded JavaScript
      // evaluation, no font-face installation, no network font fetches.
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      // Without this pdf.js logs "Ensure that the `standardFontDataUrl` API
      // parameter is provided" for every document using a standard font —
      // which is every document exported from Word. Resolved from the package
      // rather than hard-coded so it survives a hoisting/layout change.
      standardFontDataUrl: standardFontDataUrl(),
    });
    const doc = await task.promise;
    pageCount = doc.numPages;

    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // Items carry position; a naive join runs every line together. Break on a
      // change in the vertical transform, which is what separates lines.
      let lastY: number | undefined;
      let pageText = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5] as number;
        pageText += lastY === undefined || lastY === y ? item.str : `\n${item.str}`;
        lastY = y;
      }
      pages.push(pageText);
      page.cleanup();
    }
    // Explicit, and not in a finally: a document left undestroyed holds its
    // worker port and buffers alive, which in a worker ingesting hundreds of
    // documents is a slow leak.
    await doc.destroy();
    text = pages.join("\n\n").trim();
  } catch (err) {
    // A corrupt or encrypted PDF. Surface it as a user-fixable problem rather
    // than a 500 — the teacher is the only person who can supply another file.
    throw new ValidationError(
      CURRICULUM_ERROR_CODES.UNREADABLE_FILE,
      `This PDF could not be read (${
        err instanceof Error ? err.message.slice(0, 120) : "unknown error"
      }). It may be corrupted or password-protected.`,
    );
  }

  if (text.length < MIN_TEXT_LAYER_CHARS) {
    throw new ValidationError(
      CURRICULUM_ERROR_CODES.NO_TEXT_LAYER,
      "This PDF has no selectable text — it looks like a scan or a photograph. " +
        "Scanned documents are not supported yet. Please upload a PDF exported " +
        "from Word, or paste the text directly.",
    );
  }

  return finishText(text, "pdf", pageCount);
}

function finishText(
  raw: string,
  kind: CurriculumSourceKind,
  pageCount: number | null,
): ParsedDocument {
  const text = raw.trim();
  if (text.length === 0) {
    throw new ValidationError(
      CURRICULUM_ERROR_CODES.EMPTY_DOCUMENT,
      "There is no text to process.",
    );
  }
  return { text, kind, pageCount, checksum: checksumOf(text) };
}

/**
 * Heuristic: a buffer is text if it decodes as UTF-8 without replacement
 * characters and contains no NUL bytes. Cheaper and more reliable than
 * trusting contentType, which is only consulted to reject obvious binaries
 * early.
 */
function isProbablyText(buffer: Buffer, contentType: string | null): boolean {
  if (contentType && /^(image|video|audio)\//.test(contentType)) return false;
  const sample = buffer.subarray(0, 4096);
  if (sample.includes(0)) return false;
  return !sample.toString("utf8").includes("�");
}
