import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactElement, ReactNode } from "react";
import { useTheme } from "../theme/theme-provider";

import { fontSizes, fonts, radii, spacing } from "../theme/tokens";

/**
 * Children for components that render into a <View>.
 *
 * React Native will not render a bare string inside a <View>: on iOS/Android
 * it throws "Text strings must be rendered within a <Text> component" — a red
 * box in dev, a broken screen in production. react-native-web only logs a
 * console error and paints the text anyway, so the mistake looks fine on the
 * web target, survives screenshots, and survives unit tests that never render
 * the offending state. It shipped exactly once that way (the results screens'
 * loading and error states, fixed in #185) and was caught only by driving the
 * real app in a browser and reading the console.
 *
 * This type turns that runtime trap into a compile error, while still
 * permitting the ordinary things a View wraps: several children, a
 * `{cond && <X />}` guard, an array from .map(), null.
 *
 * It is spelled out recursively rather than as `Exclude<ReactNode, string |
 * number>`, which LOOKS right and silently does nothing. ReactNode also
 * includes `Iterable<ReactNode>`, and TypeScript treats `string` as an
 * `Iterable<string>` — so deleting the `string` member leaves the string a
 * hole to fit through, and the bad code still compiles. (Verified: with
 * `Exclude`, re-introducing the exact #185 bug typechecked clean.) Here the
 * iterable's own element type is ViewChildren, so a string fails that test
 * too and there is no way round.
 *
 * Text-rendering components (Body, Heading, Label, Notice) keep ReactNode on
 * purpose: a string is precisely what they exist to take.
 */
type ViewChildren =
  | ReactElement
  | boolean
  | null
  | undefined
  | readonly ViewChildren[];

// Shared primitives for apps/mobile.
//
// Deliberately hand-rolled rather than pulled from a component library: the
// surface needed for slice 2 is a button, a card, and some text states, and a
// library would bring its own design language to fight with the tokens in
// src/theme. packages/ui is not an option — it is web components built on
// Tailwind class names, which React Native cannot consume.

export function Screen({
  children,
  style,
}: {
  children: ViewChildren;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          // Respect notches and home indicators. A fixed padding would be
          // wrong on every device it was not measured against.
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Card({
  children,
  style,
}: {
  children: ViewChildren;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.heading, { color: colors.foreground }]}>{children}</Text>
  );
}

export function Body({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        styles.body,
        { color: muted ? colors.mutedForeground : colors.foreground },
      ]}
    >
      {children}
    </Text>
  );
}

export function Label({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.label, { color: colors.mutedForeground }]}>
      {children}
    </Text>
  );
}

export function Button({
  title,
  onPress,
  disabled = false,
  loading = false,
  variant = "primary",
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary";
}) {
  const { colors } = useTheme();
  const isPrimary = variant === "primary";
  // A button mid-request must not be tappable again — on the payment button
  // that would be a second checkout for the same invoice.
  const inert = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: isPrimary ? colors.primary : "transparent",
          borderColor: colors.primary,
          opacity: inert ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={isPrimary ? colors.primaryForeground : colors.primary}
        />
      ) : (
        <Text
          style={[
            styles.buttonText,
            { color: isPrimary ? colors.primaryForeground : colors.primary },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "danger";
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const color =
    tone === "danger"
      ? colors.danger
      : tone === "warning"
        ? colors.warning
        : colors.mutedForeground;

  return (
    <View style={[styles.notice, { borderColor: color }]}>
      <Text style={[styles.noticeText, { color }]}>{children}</Text>
    </View>
  );
}

export function CenteredMessage({ children }: { children: ViewChildren }) {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: fontSizes.title,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: fontSizes.caption,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  button: {
    minHeight: 48, // comfortably above the 44pt minimum tap target
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    fontFamily: fonts.sansSemibold,
    fontSize: fontSizes.bodyLarge,
  },
  notice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  noticeText: {
    fontFamily: fonts.sans,
    fontSize: fontSizes.caption,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
});
