import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import { ApiError, ApiNetworkError } from "../src/lib/api/client";
import { useSession } from "../src/lib/auth/session";
import { useTheme } from "../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../src/theme/tokens";
import { Body, Button, Heading, Notice, Screen } from "../src/components/ui";

export default function LoginScreen() {
  const { status, signIn } = useSession();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "authenticated") return <Redirect href="/students" />;

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await signIn({ email: email.trim().toLowerCase(), password });
      // No navigation here — the session flipping to "authenticated" makes
      // the <Redirect> above fire. One source of truth for routing.
    } catch (caught) {
      if (caught instanceof ApiNetworkError) {
        // Distinguishing this from bad credentials matters: telling someone
        // their password is wrong when they are simply on a bad connection
        // sends them to reset a password that was never the problem.
        setError("Can't reach School Kit. Check your connection and try again.");
      } else if (caught instanceof ApiError) {
        setError(
          caught.status === 401
            ? "That email or password is not right."
            : caught.message,
        );
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.fill}
      >
        <View style={styles.form}>
          <View style={styles.intro}>
            <Heading>Welcome back</Heading>
            <Body muted>Sign in to follow your child&apos;s progress.</Body>
          </View>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email address"
            placeholderTextColor={colors.mutedForeground}
            // autoCapitalize/autoCorrect off is not cosmetic: mobile keyboards
            // will happily capitalise and "correct" an email into one that
            // does not exist, producing a login failure the user cannot see
            // the cause of.
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!submitting}
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.card,
              },
            ]}
          />

          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            editable={!submitting}
            onSubmitEditing={() => void onSubmit()}
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.card,
              },
            ]}
          />

          {error ? <Notice tone="danger">{error}</Notice> : null}

          <Button
            title="Sign in"
            onPress={() => void onSubmit()}
            loading={submitting}
            disabled={email.trim().length === 0 || password.length === 0}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  form: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.md,
  },
  intro: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.sans,
    fontSize: fontSizes.bodyLarge,
  },
});
