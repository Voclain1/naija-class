import { Stack } from "expo-router";

import { useMotion } from "../theme/reduced-motion";

/**
 * The stack inside each staff tab section (CP8 — see any app/staff/<section>/
 * _layout.tsx for why each section has one).
 *
 * One component rather than seventeen copies of the same line, because these
 * stacks carry most of the app's screen pushes and therefore most of D5's
 * third use: a 150ms fade, or nothing under reduce motion (D6). A section
 * added later gets that by using this, instead of by someone remembering it.
 */
export function SectionStack() {
  const motion = useMotion();
  return <Stack screenOptions={{ headerShown: false, ...motion.stack }} />;
}
