import { useMemo, useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

import { motionPlan, type MotionPlan } from "./motion";

// The OS's reduce-motion setting, as a hook (look-and-feel.md D6).
//
// iOS: Settings → Accessibility → Motion → Reduce Motion. Android: "Remove
// animations" (animator duration scale 0). Web (react-native-web): the
// prefers-reduced-motion media query. React Native reads all three through
// one API, so nothing here is per-platform.
//
// A module-level store rather than per-component state, for the same reason
// installOnlineManager is module-scope: the answer is process-global, and
// asking once per mounted <Appear> would put dozens of async reads (and
// dozens of first frames with an unknown answer) on every list screen. Asked
// once, kept current by the change event, read synchronously after that.

let reduced: boolean | null = null;
let started = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === reduced) return;
  reduced = next;
  for (const listener of listeners) listener();
}

function start() {
  if (started) return;
  started = true;
  // Someone can switch the setting while the app is open — mid-lesson, after
  // the first fade made them queasy. Honour that without a restart. Never
  // unsubscribed: the store lives as long as the process does.
  AccessibilityInfo.addEventListener("reduceMotionChanged", set);
  // A failed query leaves `reduced` null, which motionPlan treats as "off".
  // Losing the fades on a device that cannot answer is a cosmetic loss; the
  // other way round is not.
  AccessibilityInfo.isReduceMotionEnabled().then(set, () => undefined);
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return reduced;
}

/** `true`/`false` once the OS has answered, `null` before it has. */
export function useReducedMotion(): boolean | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The motion this device should get — see ./motion for what each part means. */
export function useMotion(): MotionPlan {
  const value = useReducedMotion();
  return useMemo(() => motionPlan(value), [value]);
}
