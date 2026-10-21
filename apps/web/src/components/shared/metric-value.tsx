"use client";

import { useLayoutEffect, useRef } from "react";

/** Keep the API's complete formatted value on one line, fitting its actual
 * card width. No size containment: nested dashboard grids need natural sizes. */
export function MetricValue({ value, className }: { value: string; className: string }) {
  const boxRef = useRef<HTMLParagraphElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) return;
    let disposed = false;
    const fit = () => {
      if (disposed || box.clientWidth === 0) return;
      // Measure the CSS's preferred size afresh after a resize/font change.
      // Change font size itself so glyphs stay sharp, rather than scaling a
      // painted text layer. A small allowance covers fractional pixel edges.
      text.style.fontSize = "";
      const available = Math.max(1, box.getBoundingClientRect().width - 2);
      for (let pass = 0; pass < 5; pass++) {
        const width = text.getBoundingClientRect().width;
        if (width <= available) break;
        const fontSize = parseFloat(getComputedStyle(text).fontSize);
        text.style.fontSize = `${fontSize * available / width}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    observer.observe(text);
    void document.fonts.ready.then(fit);
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
