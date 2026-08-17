import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";

import { useSession } from "../../src/lib/auth/session";
import { useTheme } from "../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../src/theme/tokens";
import { Body, Button, Heading, Screen } from "../../src/components/ui";
import { extractToken } from "../../src/lib/auth/extract-token";

// Manual entry for an invitation code.
//
// WHY THIS EXISTS AT ALL: a link a parent sends over WhatsApp will NOT open
// the app on a device. app.json DOES declare a custom scheme (`schoolkit`,
// asserted by __tests__/app-config.spec.ts), so `schoolkit://…` would open
// it — but nobody sends that, and no messaging app makes it tappable. An
// ordinary https:// link needs Universal Links (iOS `associatedDomains`) and
// App Links (Android `intentFilters` plus a hosted assetlinks.json), none of
// which are configured; they need a real signed build to set up, so they land
// with the store submission work.
//
// Without this screen the entire activation flow is therefore unreachable on
// a real phone, which would make the student principal unusable by an actual
// child.
//
// It also survives deep linking arriving later: a child who taps a link gets
// /activate/<token> directly, and a child whose link did not open the app can
// still paste it here. Both routes end at the same accept screen.

export default function ActivateEntryScreen() {
  const { status, principal } = useSession();
  const { colors } = useTheme();
  const router = useRouter();
  const [value, setValue] = useState("");

  if (status === "authenticated" && principal === "student") {
    return <Redirect href="/me" />;
  }

  const token = extractToken(value);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Activate" }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.fill}
      >
        <View style={styles.form}>
          <View style={styles.intro}>
            <Heading>Enter your invitation</Heading>
            <Body muted>
              Paste the link or code your parent sent you. You&apos;ll choose a
              password on the next screen.
            </Body>
          </View>

          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="Paste your link or code"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.card,
              },
            ]}
          />

          <Button
            title="Continue"
            onPress={() => router.push(`/activate/${encodeURIComponent(token)}`)}
            disabled={token.length === 0}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  form: { flex: 1, justifyContent: "center", gap: spacing.md },
  intro: { gap: spacing.xs, marginBottom: spacing.sm },
  input: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.md,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
    textAlignVertical: "top",
  },
});
