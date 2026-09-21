import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { groupDestinations, type Destination } from "../lib/navigation/destinations";
import { webUrl } from "../lib/web-handoff";
import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";

// The app menu: every place this person can go, and signing out.
//
// Two parts:
//
//  - MenuButton — deliberately NOT a plain three-line "hamburger". It is a
//    filled emerald tile with a launcher-grid glyph and a small Gold Spark
//    accent, the shape people know from an app drawer. It reads as "all your
//    apps", which is what it opens, and it carries the brand rather than
//    looking like a generic web control.
//
//  - AppMenu — a sheet that slides up over the screen: who is signed in, then
//    every destination grouped the way the website's sidebar groups them, then
//    Sign out. The list comes from src/lib/navigation/destinations.ts, the SAME
//    list the dashboard grid renders, so the two can never disagree about what
//    a person may open.
//
// Sign out is here because, before this, a signed-in staff member had no way to
// sign out at all — it existed only on the lock screen. On a phone shared in a
// staffroom that is a real gap, not a nicety.

export function MenuButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open the menu"
      onPress={onPress}
      style={({ pressed }) => [
        styles.launcher,
        { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1, shadowColor: colors.primary },
      ]}
    >
      <Ionicons name="apps" size={20} color={colors.primaryForeground} />
      <View style={[styles.launcherAccent, { backgroundColor: colors.secondary, borderColor: colors.background }]} />
    </Pressable>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function AppMenu({
  visible,
  onClose,
  destinations,
  person,
  onSignOut,
}: {
  visible: boolean;
  onClose: () => void;
  destinations: Destination[];
  person: { name: string; detail: string };
  onSignOut: () => void;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sections = groupDestinations(destinations);

  function open(destination: Destination): void {
    onClose();
    if (destination.route) {
      router.push(destination.route);
      return;
    }
    if (destination.web) {
      const url = webUrl(destination.web);
      if (url) void Linking.openURL(url);
    }
  }

  function confirmSignOut(): void {
    Alert.alert("Sign out?", "You will need your password to sign in again on this phone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          onClose();
          onSignOut();
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Close the menu"
          onPress={onClose}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={[styles.person, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>
                {initials(person.name) || "•"}
              </Text>
            </View>
            <View style={styles.personText}>
              <Text style={[styles.personName, { color: colors.foreground }]} numberOfLines={1}>
                {person.name}
              </Text>
              <Text style={[styles.personDetail, { color: colors.mutedForeground }]} numberOfLines={1}>
                {person.detail}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close the menu" onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {sections.map((section) => (
              <View key={section.group} style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
                  {section.group.toUpperCase()}
                </Text>
                {section.items.map((item) => (
                  <Pressable
                    key={item.key}
                    accessibilityRole="button"
                    accessibilityLabel={item.hint ? `${item.label}. ${item.hint}` : item.label}
                    onPress={() => open(item)}
                    style={({ pressed }) => [
                      styles.row,
                      { backgroundColor: pressed ? colors.card : "transparent" },
                    ]}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: colors.primary + "1A" }]}>
                      <Ionicons name={item.icon} size={18} color={colors.primary} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowLabel, { color: colors.foreground }]}>{item.label}</Text>
                      {item.hint ? (
                        <Text style={[styles.rowHint, { color: colors.mutedForeground }]}>{item.hint}</Text>
                      ) : null}
                    </View>
                    <Ionicons
                      name={item.web ? "open-outline" : "chevron-forward"}
                      size={16}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                ))}
              </View>
            ))}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              onPress={confirmSignOut}
              style={({ pressed }) => [
                styles.signOut,
                { borderColor: colors.danger, backgroundColor: pressed ? colors.card : "transparent" },
              ]}
            >
              <Ionicons name="log-out-outline" size={18} color={colors.danger} />
              <Text style={[styles.signOutText, { color: colors.danger }]}>Sign out</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** A button and its menu, wired together — what a home screen actually places. */
export function useAppMenu() {
  const [visible, setVisible] = useState(false);
  return { visible, open: () => setVisible(true), close: () => setVisible(false) };
}

const styles = StyleSheet.create({
  launcher: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  launcherAccent: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(19, 38, 46, 0.45)",
  },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: radii.lg + 8,
    borderTopRightRadius: radii.lg + 8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2 },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.serif, fontSize: fontSizes.bodyLarge },
  personText: { flex: 1, gap: 2 },
  personName: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.bodyLarge },
  personDetail: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
  list: { gap: spacing.md, paddingBottom: spacing.md },
  section: { gap: spacing.xs },
  sectionTitle: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption, letterSpacing: 1, paddingLeft: spacing.xs },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    minHeight: 52,
  },
  rowIcon: { width: 34, height: 34, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: fonts.sansMedium, fontSize: fontSizes.body },
  rowHint: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.md,
    minHeight: 48,
    marginTop: spacing.sm,
  },
  signOutText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
});
