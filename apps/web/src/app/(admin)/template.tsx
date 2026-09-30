import type { ReactNode } from "react";

// Route transitions for the admin shell (look-and-feel Part 2, D5's third
// motion use).
//
// A `template.tsx` rather than a change to `layout.tsx`: Next remounts a
// template on every navigation and keeps a layout mounted, so this is the only
// place a per-route entrance can live. The sidebar, topbar and tour state stay
// in the layout and do NOT re-animate — which is the point. The chrome holds
// still and the panel changes, so the movement reads as "this page answered"
// rather than as the whole screen being rebuilt.
//
// 150ms and a fade. D5's own words: short enough to feel like response rather
// than animation. No slide — a horizontal or vertical push on a page this
// dense makes text move under a reader's eye mid-sentence when they navigate
// with the keyboard.
//
// prefers-reduced-motion disables it (D6).
export default function AdminTemplate({ children }: { children: ReactNode }) {
  // `data-route-transition` exists so e2e/tests/reduced-motion.spec.ts can
  // ask the BROWSER what this element's animation resolved to, rather than
  // matching a class list that can look correct and still animate for
  // someone who asked for no motion. It is a test hook, deliberately named
  // for what it marks.
  return (
    <div
      data-route-transition
      className="animate-in fade-in duration-150 motion-reduce:animate-none"
    >
      {children}
    </div>
  );
}
