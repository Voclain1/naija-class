import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { LEGAL_URLS } from "@school-kit/types";

import { useTheme } from "../theme/theme-provider";
import { fontSizes, spacing } from "../theme/tokens";

// SchoolKit's legal pages (docs/modules/data-protection.md), opened in the
// phone's browser. Shown on the sign-in screen and beside "Delete my account".

const LINKS: [string, string][] = [
  [LEGAL_URLS.privacy, "Privacy Policy"],
  [LEGAL_URLS.terms, "Terms"],
  [LEGAL_URLS.deleteAccount, "Deleting your account"],
];

export function LegalLinks() {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {LINKS.map(([url, label]) => (
        <Pressable key={url} accessibilityRole="link" onPress={() => void Linking.openURL(url)} hitSlop={8}>
          <Text style={[styles.link, { color: colors.mutedForeground }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: spacing.md, rowGap: spacing.xs },
  link: { fontSize: fontSizes.caption, textDecorationLine: "underline" },
});
