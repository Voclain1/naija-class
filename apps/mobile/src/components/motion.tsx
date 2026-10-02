import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme/theme-provider";
import { useMotion } from "../theme/reduced-motion";
import { radii } from "../theme/tokens";
import type { ViewChildren } from "./ui";

// The app's two motion components (look-and-feel.md Part 2). The third use D5
// allows, screen and tab transitions, is navigator config rather than a
// component — see app/_layout.tsx and app/staff/_layout.tsx.
//
// Built on React Native's own Animated rather than Reanimated: two effects, a
// fade and a wash, do not justify a native dependency and a Babel plugin, and
// both run on the native driver as it is (opacity and transform only).

// react-native-web has no native driver and warns on every animation that
// asks for one.
const useNativeDriver = Platform.OS !== "web";

/**
 * Content arriving where a skeleton was — D5's first use. A 180ms fade and a
 * 2px rise, and nothing more: the skeleton held the shape, so without this
 * the swap reads as a flicker; with anything longer it becomes something to
 * wait through.
 *
 * Wrap the BLOCK that replaces a skeleton, never the items of a list. A
 * staggered list entrance is the specific thing D5 rules out — a teacher
 * opening the roster forty times a day would watch it forty times.
 *
 * Runs once, on mount. Content that refreshes in place (a background refetch)
 * does not fade again, because the component is not remounted.
 */
export function Appear({ children, style }: { children: ViewChildren; style?: StyleProp<ViewStyle> }) {
  const { appear } = useMotion();
  // Starts visible when there is no motion to play, so reduce-motion never
  // gets even one frame at opacity 0.
  const progress = useRef(new Animated.Value(appear.duration === 0 ? 1 : 0)).current;

  useEffect(() => {
    if (appear.duration === 0) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: appear.duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, appear.duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [appear.rise, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * A saved row washing emerald and receding — D5's second use, the twin of
 * apps/web's `animate-settle`.
 *
 * Before this, accepting a comment changed one notice at the top of the
 * screen. On a class of forty, with the keyboard up and the eye on the text
 * just typed, that notice is off screen as often as not. The feedback belongs
 * on the row that changed, and should leave on its own.
 *
 * `trigger` replays the wash whenever it changes to a new non-null value —
 * pass the save's timestamp, so saving the same row twice settles twice.
 * The wash sits OVER the card (pointer events off) because a card paints its
 * own opaque background, which would hide anything behind it.
 *
 * Under reduce motion there is no wash at all, matching the web's
 * `motion-reduce:animate-none`. The screen's own "Saved" notice and the row's
 * "On the report card" label still say it happened.
 */
export function Settle({
  trigger,
  children,
  style,
}: {
  trigger: number | null;
  children: ViewChildren;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const { settle } = useMotion();
  const wash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (trigger === null || settle.duration === 0) {
      wash.setValue(0);
      return;
    }
    wash.setValue(settle.from);
    const animation = Animated.timing(wash, {
      toValue: 0,
      duration: settle.duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver,
    });
    animation.start();
    return () => animation.stop();
  }, [trigger, wash, settle.duration, settle.from]);

  return (
    <View style={style}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[styles.wash, { backgroundColor: colors.primary, opacity: wash }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Same radius as <Card>, so the wash fits the card it sits on.
  wash: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: radii.lg },
});
