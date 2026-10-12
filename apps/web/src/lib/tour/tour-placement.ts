// Where the first-login tour's card goes, beside the menu item it is talking
// about (components/tour/first-login-tour.tsx). Pure, so it is unit-tested.
//
// The rule the 2026-10-12 fix exists for: the card never sits on top of its
// own target. Before it, a phone showed the card as a fixed sheet along the
// bottom of the screen, over the lower half of the menu drawer, which is
// exactly where Settings, Announcements and Finance are; and a laptop measured
// an item below the fold and placed the card off-screen with it. The tour now
// scrolls the item into view first, then places the card here, with a pointer
// on the side facing the item.

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The card's edge that carries the pointer, and how far along it. */
export interface TourPointer {
  side: "left" | "top" | "bottom";
  offset: number;
}

export interface TourCardPlacement {
  top: number;
  left: number;
  width: number;
  pointer: TourPointer;
}

export const TOUR_MARGIN = 12;
export const TOUR_GAP = 14;
const DESKTOP_CARD_WIDTH = 352;
const MOBILE_CARD_MAX_WIDTH = 384;
const POINTER_INSET = 18;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function placeTourCard({
  target,
  viewport,
  card,
  isMobile,
}: {
  target: Box;
  viewport: Size;
  /** The card's measured height; its width is decided here. */
  card: { height: number };
  isMobile: boolean;
}): TourCardPlacement {
  const midX = target.left + target.width / 2;
  const midY = target.top + target.height / 2;

  // Desktop: to the right of the item, the menu's own column left clear,
  // centred on the item and kept on screen; the pointer stays on the item.
  if (!isMobile) {
    const width = DESKTOP_CARD_WIDTH;
    const right = target.left + target.width + TOUR_GAP;
    if (right + width <= viewport.width - TOUR_MARGIN) {
      const top = clamp(midY - card.height / 2, TOUR_MARGIN, viewport.height - card.height - TOUR_MARGIN);
      return {
        top,
        left: right,
        width,
        pointer: { side: "left", offset: clamp(midY - top, POINTER_INSET, card.height - POINTER_INSET) },
      };
    }
  }

  // Phone (and a desktop too narrow for the side): above or below the item,
  // whichever fits, never over it.
  const width = isMobile
    ? Math.min(viewport.width - TOUR_MARGIN * 2, MOBILE_CARD_MAX_WIDTH)
    : Math.min(DESKTOP_CARD_WIDTH, viewport.width - TOUR_MARGIN * 2);
  const left = clamp(midX - width / 2, TOUR_MARGIN, viewport.width - width - TOUR_MARGIN);
  const roomBelow = viewport.height - TOUR_MARGIN - (target.top + target.height + TOUR_GAP);
  const roomAbove = target.top - TOUR_GAP - TOUR_MARGIN;
  const below = roomBelow >= card.height || roomBelow >= roomAbove;
  const top = below
    ? clamp(target.top + target.height + TOUR_GAP, TOUR_MARGIN, viewport.height - card.height - TOUR_MARGIN)
    : clamp(target.top - TOUR_GAP - card.height, TOUR_MARGIN, viewport.height - card.height - TOUR_MARGIN);
  return {
    top,
    left,
    width,
    pointer: { side: below ? "top" : "bottom", offset: clamp(midX - left, POINTER_INSET, width - POINTER_INSET) },
  };
}
