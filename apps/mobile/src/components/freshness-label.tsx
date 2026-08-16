import { StyleSheet, Text, View } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, spacing } from "../theme/tokens";
import { describeFreshness } from "../lib/freshness";

/**
 * Subscribe to TanStack's online state.
 *
 * useSyncExternalStore rather than useState + useEffect: onlineManager is
 * exactly the "external mutable store" this hook exists for, and it avoids a
 * first-render flash of the wrong connectivity state.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (callback) => onlineManager.subscribe(callback),
    () => onlineManager.isOnline(),
    () => true,
  );
}

/**
 * The "as of <time>" line required by phase-6.md D11.
 *
 * Put this on every screen that renders cached data. `updatedAt` comes
 * straight from a TanStack query's `dataUpdatedAt`.
 *
 * It is a plain always-visible line rather than a conditional warning: a
 * banner that only appears when something is wrong trains people not to look
 * for it, and the fee screen in particular should state its own age every
 * time it is opened.
 */
export function FreshnessLabel({ updatedAt }: { updatedAt: number }) {
  const { colors } = useTheme();
  const online = useIsOnline();
  const { label, stale } = describeFreshness(updatedAt, { online });

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.dot,
          { backgroundColor: stale ? colors.warning : colors.primary },
        ]}
      />
      <Text
        style={[
          styles.text,
          { color: stale ? colors.warning : colors.mutedForeground },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: fontSizes.caption,
  },
});
