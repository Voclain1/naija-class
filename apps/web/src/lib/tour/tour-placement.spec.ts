import { describe, expect, it } from "vitest";

import { placeTourCard, TOUR_MARGIN, type Box } from "./tour-placement";

const overlaps = (a: Box, b: Box) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe("placeTourCard", () => {
  const laptop = { width: 1366, height: 768 };
  const phone = { width: 390, height: 844 };

  it("desktop: beside the menu item, centred on it, with the pointer on the item", () => {
    const target = { top: 300, left: 12, width: 232, height: 36 };
    const p = placeTourCard({ target, viewport: laptop, card: { height: 180 }, isMobile: false });
    expect(p.left).toBeGreaterThan(target.left + target.width);
    expect(p.top + p.pointer.offset).toBe(target.top + target.height / 2);
    expect(p.pointer.side).toBe("left");
  });

  it("desktop: an item at the bottom of the menu keeps the card on screen, pointer still on the item", () => {
    const target = { top: 720, left: 12, width: 232, height: 36 };
    const p = placeTourCard({ target, viewport: laptop, card: { height: 180 }, isMobile: false });
    expect(p.top + 180).toBeLessThanOrEqual(laptop.height - TOUR_MARGIN);
    expect(p.top + p.pointer.offset).toBe(target.top + target.height / 2);
  });

  it("phone: Settings low in the drawer gets the card ABOVE it, not over it", () => {
    const settings = { top: 700, left: 12, width: 260, height: 40 };
    const p = placeTourCard({ target: settings, viewport: phone, card: { height: 200 }, isMobile: true });
    const card = { top: p.top, left: p.left, width: p.width, height: 200 };
    expect(overlaps(card, settings)).toBe(false);
    expect(p.pointer.side).toBe("bottom");
    expect(p.top).toBeGreaterThanOrEqual(TOUR_MARGIN);
  });

  it("phone: an item near the top gets the card below it", () => {
    const students = { top: 120, left: 12, width: 260, height: 40 };
    const p = placeTourCard({ target: students, viewport: phone, card: { height: 200 }, isMobile: true });
    const card = { top: p.top, left: p.left, width: p.width, height: 200 };
    expect(overlaps(card, students)).toBe(false);
    expect(p.pointer.side).toBe("top");
  });

  it("phone: the card fits the screen width with a margin either side", () => {
    const p = placeTourCard({
      target: { top: 400, left: 12, width: 260, height: 40 },
      viewport: phone,
      card: { height: 200 },
      isMobile: true,
    });
    expect(p.left).toBeGreaterThanOrEqual(TOUR_MARGIN);
    expect(p.left + p.width).toBeLessThanOrEqual(phone.width - TOUR_MARGIN);
  });

  it("never covers the item on any row of a phone-height menu", () => {
    for (let top = 60; top <= 780; top += 40) {
      const item = { top, left: 12, width: 260, height: 40 };
      const p = placeTourCard({ target: item, viewport: phone, card: { height: 220 }, isMobile: true });
      expect(overlaps({ top: p.top, left: p.left, width: p.width, height: 220 }, item), `item at ${top}`).toBe(false);
    }
  });
});
