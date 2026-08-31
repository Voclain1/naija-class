import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from "react-native";
import { Link, Stack } from "expo-router";

import { guardianForgotPassword } from "../src/lib/api/portal";
import { useTheme } from "../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../src/theme/tokens";
import { Body, Button, Heading, Notice, Screen } from "../src/components/ui";

export default function ForgotPasswordScreen() {
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"form" | "sent" | "error">("form");
  async function submit() {
    setBusy(true);
    try {
      await guardianForgotPassword({ email: email.trim().toLowerCase() });
      setState("sent");
    } catch {
      // Deliberately uninspected: this screen shows the same copy for every
      // failure, so a wrong address can't be told apart from a send failure.
      setState("error");
    } finally { setBusy(false); }
  }
  return <Screen><Stack.Screen options={{ headerShown: true, title: "Reset password" }} />
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.fill}>
      <View style={styles.form}>
        <Heading>Reset your password</Heading>
        {state === "sent" ? <Notice>Email recovery instructions have been sent if an account exists for that address. Open the link in your email, set a new password in the SchoolKit parent portal, then return here to sign in.</Notice> : <>
          <Body muted>Enter the email address you use for the SchoolKit parent portal.</Body>
          <TextInput value={email} onChangeText={setEmail} placeholder="Email address" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} editable={!busy} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]} />
          {state === "error" ? <Notice tone="danger">We couldn&apos;t send recovery instructions. Check your connection and try again.</Notice> : null}
          <Button title="Send reset instructions" onPress={() => void submit()} loading={busy} disabled={busy || email.trim().length === 0} />
        </>}
        <Link href="/login"><Body muted>Back to sign in</Body></Link>
      </View>
    </KeyboardAvoidingView>
  </Screen>;
}
const styles = StyleSheet.create({ fill: { flex: 1 }, form: { flex: 1, justifyContent: "center", gap: spacing.md }, input: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, paddingHorizontal: spacing.md, fontFamily: fonts.sans, fontSize: fontSizes.bodyLarge } });
