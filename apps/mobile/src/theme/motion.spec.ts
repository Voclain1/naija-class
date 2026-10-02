import { describe, expect, it } from "vitest";

import { MOTION, motionPlan } from "./motion";

// D6 — "respect prefers-reduced-motion, and mean it".
//
// Both directions are asserted. A spec that only checks the OFF state passes
// just as happily when the motion was never built — the same reason
// e2e/tests/reduced-motion.spec.ts checks the animation IS present on the web.

describe("motionPlan", () => {
  it("animates all three D5 uses when the OS has not asked for less motion", () => {
    const plan = motionPlan(false);
    expect(plan.appear.duration).toBeGreaterThan(0);
    expect(plan.appear.rise).toBeGreaterThan(0);
    expect(plan.settle.duration).toBeGreaterThan(0);
    expect(plan.settle.from).toBeGreaterThan(0);
    expect(plan.stack.animation).toBe("fade");
    expect(plan.tabs.animation).toBe("fade");
  });

  it("turns every one of them off — not shorter, off — when reduce motion is on", () => {
    const plan = motionPlan(true);
    expect(plan.appear).toEqual({ duration: 0, rise: 0 });
    expect(plan.settle).toEqual({ duration: 0, from: 0 });
    expect(plan.stack.animation).toBe("none");
    expect(plan.tabs.animation).toBe("none");
  });

  it("treats an OS that has not answered yet as reduce motion on", () => {
    // The setting is read asynchronously; until it arrives, the safe guess is
    // the one that cannot make anyone unwell.
    expect(motionPlan(null)).toEqual(motionPlan(true));
  });

  it("keeps route transitions inside D5's 150–200ms", () => {
    expect(MOTION.route.duration).toBeGreaterThanOrEqual(150);
    expect(MOTION.route.duration).toBeLessThanOrEqual(200);
    expect(motionPlan(false).stack.animationDuration).toBe(MOTION.route.duration);
  });

  it("matches the web's timings, so the product moves at one speed", () => {
    // apps/web: Appear is a fade plus a 2px rise (look-and-feel.md D6 names
    // 180ms), settle is 900ms from 16% primary (tailwind.config.ts), and the
    // route template fades in 150ms.
    expect(MOTION.appear).toEqual({ duration: 180, rise: 2 });
    expect(MOTION.settle).toEqual({ duration: 900, from: 0.16 });
    expect(MOTION.route.duration).toBe(150);
  });

  it("hands out copies, so a caller cannot change the shared timings", () => {
    const plan = motionPlan(false);
    plan.appear.duration = 9999;
    expect(motionPlan(false).appear.duration).toBe(MOTION.appear.duration);
  });
});
