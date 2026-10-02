// Motion for the app (docs/modules/look-and-feel.md Part 2, D5 and D6).
//
// D5 allows three uses of motion and nothing else, and this file holds the
// numbers for exactly those three:
//
// - APPEAR — content arriving where a skeleton was, so a screen resolves
//   rather than jumps.
// - SETTLE — the row a teacher just saved washes emerald and recedes, so the
//   feedback lands on the thing that changed.
// - ROUTE — screen and tab transitions, short enough to read as response
//   rather than animation.
//
// The timings match apps/web on purpose (Appear 180ms + 2px rise, settle
// 900ms from 16% primary, route fade 150ms): the same product should not move
// at two speeds depending on which screen it is opened on.
//
// DELIBERATELY react-native-free, like ./preference: apps/mobile's Vitest runs
// node-env with no React Native transform, so the D6 rule lives here where a
// spec can reach it. The OS seam is ./reduced-motion, the components are
// src/components/motion.tsx.

export const MOTION = {
  appear: { duration: 180, rise: 2 },
  settle: { duration: 900, from: 0.16 },
  /**
   * 150ms, and not by choice alone: it is also what react-native-screens'
   * Android `fade` runs at (rns_fade_in.xml), where the duration cannot be
   * set from JS. `animationDuration` only applies on iOS, so this keeps the
   * two platforms the same speed.
   */
  route: { duration: 150 },
} as const;

export interface MotionPlan {
  appear: { duration: number; rise: number };
  settle: { duration: number; from: number };
  /** Spread into the root Stack's screenOptions. */
  stack: { animation: "fade" | "none"; animationDuration: number };
  /** Spread into a Tabs navigator's screenOptions. */
  tabs: { animation: "fade" | "none" };
}

/**
 * What to animate, given the OS's reduce-motion setting.
 *
 * D6: respect it, and MEAN it. Every one of the three uses is off when it is
 * set — not shortened, off. A vestibular reaction to a 150ms fade is still a
 * reaction.
 *
 * `null` means the OS has not answered yet (the query is async), and it
 * resolves to NO motion. The other way round, the person who most needs
 * motion off is the one who gets the first animation of every launch.
 */
export function motionPlan(reduced: boolean | null): MotionPlan {
  if (reduced !== false) {
    return {
      appear: { duration: 0, rise: 0 },
      settle: { duration: 0, from: 0 },
      stack: { animation: "none", animationDuration: 0 },
      tabs: { animation: "none" },
    };
  }
  return {
    appear: { ...MOTION.appear },
    settle: { ...MOTION.settle },
    stack: { animation: "fade", animationDuration: MOTION.route.duration },
    tabs: { animation: "fade" },
  };
}
