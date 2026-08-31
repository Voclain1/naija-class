import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  acceptStudentInvitation,
  getStudentInvitation,
} from "../../src/lib/api/student-portal";
import { ApiError, ApiNetworkError } from "../../src/lib/api/client";
import { useSession } from "../../src/lib/auth/session";
import { useTheme } from "../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../src/theme/tokens";
import {
  Body,
  Button,
  CenteredMessage,
  Heading,
  Notice,
  Screen,
} from "../../src/components/ui";

// D26 — a child turning a single-use invitation into an account.
//
// UNAUTHENTICATED by necessity: the child has no session, which is exactly
// why the server resolves the token through a SECURITY DEFINER function
// before any tenant context exists.
//
// The lookup deliberately does not return the student's name, so this screen
// cannot greet them by it. That is not an oversight to fix later: the token
// comes from whoever is holding the link, and a name would turn a forwarded
// screenshot into a disclosure of which child it belongs to.

const MIN_PASSWORD = 8;

export default function AcceptInvitationScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { status, principal, adoptStudentSession } = useSession();
  const { colors } = useTheme();
  const raw = typeof token === "string" ? token.trim() : "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invitationQuery = useQuery({
    queryKey: ["invitation", raw],
    queryFn: () => getStudentInvitation(raw),
    enabled: raw.length > 0,
    // A single-use token is not worth retrying against: if it resolved once it
    // will resolve again, and if it did not, hammering it just delays the
    // "this link is no longer valid" the child needs to see.
    retry: false,
  });

  // Already signed in as a student — the accept below has just succeeded, or
  // they opened an old link while signed in. Either way, forward.
  if (status === "authenticated" && principal === "student") {
    return <Redirect href="/me" />;
  }

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    password.length >= MIN_PASSWORD && confirm === password && !submitting;

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await acceptStudentInvitation(raw, { password });
      // Accept returns a full login payload, so the child is signed in from
      // this moment. The <Redirect> above fires on the next render.
      await adoptStudentSession(response);
    } catch (caught) {
      if (caught instanceof ApiNetworkError) {
        setError("Can't reach SchoolKit. Check your connection and try again.");
      } else if (caught instanceof ApiError) {
        setError(
          caught.status === 404 || caught.status === 410
            ? "This link is no longer valid. Ask your parent for a new one."
            : caught.message,
        );
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = [
    styles.input,
    {
      color: colors.foreground,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
  ];

  return (
    <Screen>
      {/* Header says "Activate", the body says "Set your password". Using the
          same phrase in both stacks the identical sentence twice on one small
          screen, which reads as a rendering bug rather than emphasis. */}
      <Stack.Screen options={{ headerShown: true, title: "Activate" }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.fill}
      >
        {invitationQuery.isPending && (
          <CenteredMessage>
            <Body muted>Checking your link…</Body>
          </CenteredMessage>
        )}

        {invitationQuery.isError && (
          <CenteredMessage>
            <Notice tone="danger">
              This link is no longer valid. Ask your parent for a new one.
            </Notice>
          </CenteredMessage>
        )}

        {invitationQuery.data && (
          <View style={styles.form}>
            <View style={styles.intro}>
              <Heading>Set your password</Heading>
              <Body muted>
                You&apos;re joining {invitationQuery.data.schoolName}. Choose a
                password only you know — you&apos;ll use it to sign in from now
                on.
              </Body>
            </View>

            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={`Password (at least ${MIN_PASSWORD} characters)`}
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              editable={!submitting}
              style={inputStyle}
            />

            <TextInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Type it again"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              editable={!submitting}
              onSubmitEditing={() => canSubmit && void onSubmit()}
              style={inputStyle}
            />

            {/* Inline guidance rather than a failed submit: a child typing a
                short password should be told before they tap, not after. */}
            {tooShort ? (
              <Body muted>Use at least {MIN_PASSWORD} characters.</Body>
            ) : null}
            {mismatch ? <Body muted>Both passwords must match.</Body> : null}
            {error ? <Notice tone="danger">{error}</Notice> : null}

            <Button
              title="Set password and sign in"
              onPress={() => void onSubmit()}
              loading={submitting}
              disabled={!canSubmit}
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  form: { flex: 1, justifyContent: "center", gap: spacing.md },
  intro: { gap: spacing.xs, marginBottom: spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.sans,
    fontSize: fontSizes.bodyLarge,
  },
});
