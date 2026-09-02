// A minimal, valid, text-layer PDF builder — for SPECS ONLY.
//
// Phase 7 / CP2 needs to prove that real PDF text extraction works, not that a
// mock returns a string. Committing a binary fixture would work, but a
// generator is better here for three reasons: the spec can state exactly what
// text it expects to get back, it can build a MULTI-PAGE document to prove
// page joining, and it can build a pathological one (no text layer) to prove
// the scanned-document refusal path that D6 depends on.
//
// This writes uncompressed content streams with a correct xref table. It is
// not a general-purpose PDF writer and should never be used outside tests.

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * Characters per line before wrapping.
 *
 * Real PDFs wrap; a generated one must too. Learned the hard way: an early
 * version of this helper emitted each input line as a single Tj no matter how
 * long, and pdf.js CLIPPED the glyphs that ran past the MediaBox edge — so a
 * 400-character line came back as 110 characters and the specs failed against
 * a parser that was working correctly. 90 characters is comfortably inside a
 * 612pt page at 12pt Helvetica.
 */
const WRAP_AT = 90;

function wrap(line: string): string[] {
  if (line.length <= WRAP_AT) return [line];
  const words = line.split(" ");
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length > 0 && current.length + 1 + word.length > WRAP_AT) {
      out.push(current);
      current = word;
    } else {
      current = current.length === 0 ? word : `${current} ${word}`;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Build a PDF whose pages contain the given lines of text.
 *
 * @param pages one array of lines per page.
 */
export function makeTextPdf(pages: ReadonlyArray<ReadonlyArray<string>>): Buffer {
  const objects: string[] = [];
  const pageCount = pages.length;

  // Object numbering: 1 = catalog, 2 = pages, 3 = font,
  // then per page: (4 + 2i) = page, (5 + 2i) = its content stream.
  const pageObjNum = (i: number): number => 4 + i * 2;
  const contentObjNum = (i: number): number => 5 + i * 2;

  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(" ");

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((lines, i) => {
    objects[pageObjNum(i)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjNum(i)} 0 R >>`;

    // One Tj per (wrapped) line, T* moving down by the 14pt leading.
    const wrapped = lines.flatMap((l) => wrap(l));
    const body =
      "BT\n/F1 12 Tf\n72 720 Td\n14 TL\n" +
      wrapped.map((l) => `(${escapePdfText(l)}) Tj T*`).join("\n") +
      "\nET";
    objects[contentObjNum(i)] = `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;
  });

  // Serialise, tracking byte offsets for the xref table.
  const maxObj = contentObjNum(pageCount - 1);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let n = 1; n <= maxObj; n++) {
    offsets[n] = Buffer.byteLength(out, "latin1");
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${maxObj + 1}\n`;
  out += "0000000000 65535 f \n";
  for (let n = 1; n <= maxObj; n++) {
    out += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(out, "latin1");
}

/**
 * A structurally valid PDF with a page but NO text-drawing operators — the
 * shape a scanned/photographed document takes once the image is stripped.
 * Used to prove the "no text layer" refusal (D6), which is the difference
 * between a helpful error and a silently empty document.
 */
export function makeImageOnlyPdf(): Buffer {
  return makeTextPdf([[]]);
}
