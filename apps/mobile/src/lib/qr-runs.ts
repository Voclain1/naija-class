import qrcode from "qrcode-generator";

// A QR code as rows of dark runs, for drawing with plain Views (qr-code.tsx).
export function qrRuns(value: string): { size: number; rows: { start: number; length: number }[][] } {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const size = qr.getModuleCount();
  const rows: { start: number; length: number }[][] = [];
  for (let r = 0; r < size; r++) {
    const runs: { start: number; length: number }[] = [];
    let c = 0;
    while (c < size) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < size && qr.isDark(r, c)) c++;
      runs.push({ start, length: c - start });
    }
    rows.push(runs);
  }
  return { size, rows };
}
