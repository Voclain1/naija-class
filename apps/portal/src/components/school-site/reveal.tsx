"use client";

import { useEffect } from "react";

// Sections fade up as they scroll into view (docs/modules/school-website.md,
// "The look"). Everything is visible without this script: it only hides what
// is still below the fold when it runs, then shows each section as it
// arrives. Off for anyone who asks for less motion.
export function RevealOnScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-ss-reveal]")).filter(
      (el) => el.getBoundingClientRect().top > window.innerHeight,
    );
    for (const el of targets) el.classList.add("ss-reveal-wait");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.classList.add("ss-reveal-in");
          el.classList.remove("ss-reveal-wait");
          observer.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    for (const el of targets) observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return null;
}
