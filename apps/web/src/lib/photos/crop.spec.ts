import { describe, expect, it } from "vitest";

import { admissionNumberFromFileName, baseWindow, cropRect, initialCrop, panCrop } from "./crop";

describe("passport crop", () => {
  it("fits the largest 35 × 45 window into a landscape and a portrait picture", () => {
    expect(baseWindow(1600, 900)).toEqual({ width: 700, height: 900 });
    const tall = baseWindow(700, 2000);
    expect(tall.width).toBe(700);
    expect(tall.height).toBeCloseTo(900);
  });

  it("starts centred across and a little high, inside the picture", () => {
    const crop = initialCrop(1600, 900);
    const rect = cropRect(1600, 900, crop);
    expect(rect.x).toBe(450);
    expect(rect.y).toBe(0);
    expect(rect.width / rect.height).toBeCloseTo(35 / 45);
  });

  it("zooms in around the centre and never leaves the picture", () => {
    const rect = cropRect(1600, 900, { zoom: 2, cx: 10, cy: 10 });
    expect(rect).toEqual({ x: 0, y: 0, width: 350, height: 450 });
    const capped = cropRect(1600, 900, { zoom: 99, cx: 800, cy: 450 });
    expect(capped.width).toBe(175);
  });

  it("dragging right moves the window left", () => {
    const start = { zoom: 2, cx: 800, cy: 450 };
    const moved = panCrop(1600, 900, start, 100, 0, 350);
    expect(moved.cx).toBe(700);
    expect(moved.cy).toBe(450);
  });

  it("reads the admission number from a file name", () => {
    expect(admissionNumberFromFileName("SKA-0042.jpg")).toBe("SKA-0042");
    expect(admissionNumberFromFileName(" ska 7 .JPEG")).toBe("ska 7");
    expect(admissionNumberFromFileName("noext")).toBe("noext");
  });
});
