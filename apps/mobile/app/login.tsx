import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, Redirect } from "expo-router";
import { ApiError, ApiNetworkError } from "../src/lib/api/client";
import { useSession } from "../src/lib/auth/session";
import { useTheme } from "../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../src/theme/tokens";
import { Body, Button, Heading, Notice, Screen } from "../src/components/ui";

// One login screen, two principals.
//
// Not two screens behind a chooser: a parent and a child on a shared handset
// both start here, and an extra "who are you?" step before either can even see
// a form is a wall in front of the only door. The toggle is the first thing on
// the screen and the form beneath it changes — nothing is hidden behind a
// second navigation.
type Mode = "guardian" | "student";

export default function LoginScreen() {
  const { status, principal, signIn, signInStudent } = useSession();
  const { colors } = useTheme();
  const [mode, setMode] = useState<Mode>("guardian");

  // Guardian fields
  const [email, setEmail] = useState("");
  // Student fields
  const [schoolSlug, setSchoolSlug] = useState("");
  const [admissionNumber, setAdmissionNumber] = useState("");
  // Shared
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "authenticated") {
    return <Redirect href={principal === "student" ? "/me" : "/students"} />;
  }

  const isStudent = mode === "student";
  const canSubmit = isStudent
    ? schoolSlug.trim().length > 0 &&
      admissionNumber.trim().length > 0 &&
      password.length > 0
    : email.trim().length > 0 && password.length > 0;

  function switchMode(next: Mode) {
    // Clear the error when switching: a failure from the parent form is not
    // about the student form, and leaving it up reads as though the new form
    // has already been rejected before it was filled in.
    setError(null);
    setMode(next);
  }

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      if (isStudent) {
        // Trimming/lowercasing of the school code and trimming of the
        // admission number also happen server-side in studentLoginSchema.
        // Doing it here too means the value the child sees in the box is the
        // value that gets sent — not a silently different one.
        await signInStudent({
          schoolSlug: schoolSlug.trim().toLowerCase(),
          admissionNumber: admissionNumber.trim(),
          password,
        });
      } else {
        await signIn({ email: email.trim().toLowerCase(), password });
      }
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
            ? isStudent
              ? // Deliberately does not say which of the three was wrong. The
                // server refuses to distinguish "no such school", "no such
                // admission number" and "wrong password" — admission numbers
                // are sequential and school slugs are public, so a specific
                // message would let anyone enumerate a school's roll.
                "That school code, admission number or password is not right."
              : "That email or password is not right."
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
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.fill}
      >
        <View style={styles.form}>
          <View style={styles.intro}>
            <Heading>Welcome back</Heading>
            <Body muted>
              {isStudent
                ? "Sign in to see your results."
                : "Sign in to follow your child's progress."}
            </Body>
          </View>

          <View style={[styles.switcher, { borderColor: colors.border }]}>
            {(["guardian", "student"] as const).map((option) => {
              const active = mode === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  disabled={submitting}
                  onPress={() => switchMode(option)}
                  style={[
                    styles.switchOption,
                    active && { backgroundColor: colors.primary },
                  ]}
                >
                  <Text
                    style={[
                      styles.switchLabel,
                      {
                        color: active
                          ? colors.primaryForeground
                          : colors.mutedForeground,
                      },
                    ]}
                  >
                    {option === "guardian" ? "Parent" : "Student"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {isStudent ? (
            <>
              <TextInput
                value={schoolSlug}
                onChangeText={setSchoolSlug}
                placeholder="School code"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
                style={inputStyle}
              />
              <TextInput
                value={admissionNumber}
                onChangeText={setAdmissionNumber}
                placeholder="Admission number"
                placeholderTextColor={colors.mutedForeground}
                // Case is NOT folded here, matching the server: a school may
                // legitimately have issued both "abc/1" and "ABC/1".
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!submitting}
                style={inputStyle}
              />
            </>
          ) : (
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
              style={inputStyle}
            />
          )}

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
            style={inputStyle}
          />

          {error ? <Notice tone="danger">{error}</Notice> : null}

          <Button
            title="Sign in"
            onPress={() => void onSubmit()}
            loading={submitting}
            disabled={!canSubmit}
          />

          {/* First-time students have no password yet — they have an
              invitation from their parent. Without this the activation flow
              is unreachable on a device, because an https link does not open
              the app (see app/activate/index.tsx for exactly what is and is
              not configured). */}
          {isStudent ? (
            <Link href="/activate" asChild>
              <Pressable style={styles.activateLink} disabled={submitting}>
                <Text style={[styles.activateText, { color: colors.primary }]}>
                  First time? Use your invitation
                </Text>
              </Pressable>
            </Link>
          ) : null}
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
  switcher: {
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    overflow: "hidden",
  },
  switchOption: {
    flex: 1,
    minHeight: 44, // the minimum comfortable tap target
    alignItems: "center",
    justifyContent: "center",
  },
  switchLabel: {
    fontFamily: fonts.sansSemibold,
    fontSize: fontSizes.body,
  },
  activateLink: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  activateText: {
    fontFamily: fonts.sansSemibold,
    fontSize: fontSizes.body,
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
