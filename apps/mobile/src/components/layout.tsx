import { Ionicons } from "@expo/vector-icons";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { Body, Card, Label } from "./ui";

// CP8 — the layout vocabulary every staff screen shares.
//
// Before this, each screen set its own spacing, wrote its own header and
// invented its own empty state, because each checkpoint added one screen and
// none owned the whole. The result reads as a prototype: nothing is WRONG, but
// nothing lines up either, and that is what "doesn't look professional"
// means in practice.
//
// The brand does not change here — Paper, Ink, Deep Emerald, Fraunces and
// Hanken Grotesk are already in src/theme/tokens.ts and already match
// apps/web. What was missing is everything above the tokens: hierarchy,
// rhythm, iconography, and components that repeat.
//
// D28: icons NEVER carry meaning alone. Every one sits beside its label. An
// icon grid where the picture IS the label fails anyone who does not recognise
// the metaphor — which, for teachers new to smartphones, is the whole point.

export type IconName = keyof typeof Ionicons.glyphMap;

/**
 * The top of a screen: what this is, and one line about it.
 *
 * Replaces the ad-hoc <Heading> + <Body muted> pair each screen grew its own
 * version of, so titles sit at the same height on every screen.
 */
export function ScreenHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string | null;
  action?: ReactElement | null;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? <Body muted>{subtitle}</Body> : null}
      </View>
      {action ?? null}
    </View>
  );
}

/** A quiet divider between groups of content, with an optional trailing note. */
export function SectionHeader({ title, note }: { title: string; note?: string | null }) {
  return (
    <View style={styles.sectionHeader}>
      <Label>{title}</Label>
      {note ? <Label>{note}</Label> : null}
    </View>
  );
}

/**
 * One square in the dashboard grid: icon, label, and an optional one-word
 * hint. Sized so two fit a narrow phone and the touch target stays generous.
 */
export function ActionTile({
  icon,
  label,
  hint,
  onPress,
  tone = "default",
}: {
  icon: IconName;
  label: string;
  hint?: string | null;
  onPress: () => void;
  tone?: "default" | "accent";
}) {
  const { colors } = useTheme();
  const accent = tone === "accent" ? colors.secondary : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: accent + "1A" }]}>
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <Text style={[styles.tileLabel, { color: colors.foreground }]} numberOfLines={2}>
        {label}
      </Text>
      {hint ? (
        <Text style={[styles.tileHint, { color: colors.mutedForeground }]} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The grid the tiles sit in. Wraps, so it adapts to any phone width. */
export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/**
 * A single fact with its icon — "next lesson", "register not marked".
 *
 * D30: the caller renders nothing at all when there is no fact to state. A
 * placeholder dash pretending to be data is worse than an absent row.
 */
export function StatRow({
  icon,
  label,
  value,
  tone = "default",
  onPress,
}: {
  icon: IconName;
  label: string;
  value: string;
  tone?: "default" | "warning";
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const accent = tone === "warning" ? colors.warning : colors.primary;
  const content = (
    <View style={styles.statRow}>
      <Ionicons name={icon} size={18} color={accent} />
      <View style={styles.statText}>
        <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
        <Label>{label}</Label>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${value}. ${label}`} onPress={onPress}>
      {content}
    </Pressable>
  );
}

/** A tappable row in a list: title, supporting line, chevron. */
export function ListRow({
  title,
  subtitle,
  meta,
  icon,
  onPress,
  style,
}: {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  icon?: IconName;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const inner = (
    <Card style={[styles.row, style]}>
      {icon ? <Ionicons name={icon} size={20} color={colors.primary} /> : null}
      <View style={styles.rowText}>
        <Body>{title}</Body>
        {subtitle ? <Label>{subtitle}</Label> : null}
      </View>
      {meta ? <Label>{meta}</Label> : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} /> : null}
    </Card>
  );
  if (!onPress) return inner;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={onPress}
    >
      {inner}
    </Pressable>
  );
}

/**
 * Nothing here, and what to do about it.
 *
 * An empty state that only says "nothing yet" leaves the reader to work out
 * whether that is normal, their fault, or a failure. Every one of these names
 * the reason and, where there is one, the action.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  action?: ReactElement | null;
}) {
  const { colors } = useTheme();
  return (
    <Card style={styles.empty}>
      <Ionicons name={icon} size={28} color={colors.mutedForeground} />
      <Body>{title}</Body>
      <Label>{body}</Label>
      {action ?? null}
    </Card>
  );
}

/**
 * A placeholder that holds the SHAPE of what is coming.
 *
 * "Loading…" tells the reader to wait; a skeleton tells them what for, and the
 * screen does not jump when the content lands.
 */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  const { colors } = useTheme();
  return (
    <Card style={styles.skeleton}>
      {Array.from({ length: lines }).map((_, index) => (
        <View
          key={index}
          style={[
            styles.skeletonLine,
            {
              backgroundColor: colors.border,
              width: index === lines - 1 ? "55%" : "100%",
            },
          ]}
        />
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  headerText: { flex: 1, gap: spacing.xs },
  title: { fontFamily: fonts.serif, fontSize: fontSizes.title },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    // Two per row on a narrow phone, three on a wide one, with the gap
    // accounted for so the last tile never wraps alone.
    flexGrow: 1,
    flexBasis: "45%",
    minHeight: 104,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
    justifyContent: "flex-start",
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  tileLabel: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  tileHint: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
  statRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  statText: { flex: 1, gap: 2 },
  statValue: { fontFamily: fonts.sansMedium, fontSize: fontSizes.body },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowText: { flex: 1, gap: spacing.xs },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  skeleton: { gap: spacing.sm },
  skeletonLine: { height: 12, borderRadius: radii.sm, opacity: 0.7 },
});
