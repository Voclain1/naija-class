import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../src/theme/theme-provider";
import { FreshnessLabel, useIsOnline } from "../src/components/freshness-label";
import { fontSizes, fonts, radii, spacing } from "../src/theme/tokens";

// Slice 1 landing screen.
//
// Deliberately not a real feature: slice 1 is the foundation, and the first
// real screens are slice 2's guardian flows. What this screen IS for is
// exercising the foundation end to end on a device — brand fonts render, the
// theme responds to the OS dark-mode setting, and the connectivity + freshness
// primitives report real state. If any of those are wrong, it should be
// visible here before a feature is built on top of them.

export default function HomeScreen() {
  const { colors } = useTheme();
  const online = useIsOnline();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          School Kit
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Phase 6 · slice 1 — foundation
        </Text>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
          Connectivity
        </Text>
        <Text style={[styles.cardValue, { color: colors.primary }]}>
          {online ? "Online" : "Offline"}
        </Text>
        {/* Date.now() stands in for a real query's dataUpdatedAt until slice 2
            has one. The component contract is identical either way. */}
        <FreshnessLabel updatedAt={Date.now()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.xl,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: fontSizes.display,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: fontSizes.caption,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  cardValue: {
    fontFamily: fonts.serif,
    fontSize: fontSizes.title,
  },
});
