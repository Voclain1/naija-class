"use client";

import { useLayoutEffect, useRef } from "react";

/** Keep the API's complete formatted value on one line, fitting its actual
 * card width. No size containment: nested dashboard grids need natural sizes.
 *
 * Refits only when the box's WIDTH changes (or the web font arrives). Fitting
 * changes the text's size and so the box's height; watching either of those
 * let one fit trigger the next, so the dashboard tiles kept changing height
 * while a phone scrolled (2026-10-24). */
export function MetricValue({ value, className }: { value: string; className: string }) {
  const boxRef = useRef<HTMLParagraphElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    let disposed = false;
    let fittedWidth = -1;
    const fit = (force: boolean) => {
      if (disposed) return;
      const boxWidth = box.getBoundingClientRect().width;
      if (boxWidth === 0 || (!force && boxWidth === fittedWidth)) return;
      fittedWidth = boxWidth;
      // Measure the CSS's preferred size afresh after a width or font change.
      // Change font size itself so glyphs stay sharp, rather than scaling a
      // painted text layer. A small allowance covers fractional pixel edges.
      text.style.fontSize = "";
      const available = Math.max(1, boxWidth - 2);
      for (let pass = 0; pass < 5; pass++) {
        const width = text.getBoundingClientRect().width;
        if (width <= available) break;
        const fontSize = parseFloat(getComputedStyle(text).fontSize);
        text.style.fontSize = `${fontSize * available / width}px`;
      }
    };
    fit(true);
    const observer = new ResizeObserver(() => fit(false));
    observer.observe(box);
    void document.fonts.ready.then(() => fit(true));
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [value]);

  return (
    <p ref={boxRef} data-metric-length={value.length > 9 ? "long" : "short"} className={className}>
      <span ref={textRef} className="metric-value-text">{value}</span>
    </p>
  );
}
