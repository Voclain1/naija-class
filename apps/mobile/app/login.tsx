import { useEffect, useState } from "react";
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
import { loadSchoolHint } from "../src/lib/auth/school-hint-store";
import { shouldCollapseSchoolField } from "../src/lib/auth/school-hint";
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
type Mode = "guardian" | "student" | "staff";

export default function LoginScreen() {
  const { status, principal, signIn, signInStudent, signInStaff, completeStaffTwoFactor } = useSession();
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
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  // The school code remembered from the last student sign-in or activation on
  // this device, and whether the user has asked to change it. Kept separate
  // from schoolSlug because schoolSlug is what gets SUBMITTED and is editable;
  // this is only the answer to "do we have one, and is it still being used?".
  const [rememberedSlug, setRememberedSlug] = useState<string | null>(null);
  const [editingSchool, setEditingSchool] = useState(false);

  // A child is told their admission number by the school and chooses their own
  // password, but nobody ever tells them a school code — so without this, a
  // second sign-in can be impossible for them alone.
  //
  // Only ever fills a field the user has not touched: the guard means a
  // late-resolving read cannot overwrite something already being typed, and
  // a family sharing one handset across two schools can still type over it.
  useEffect(() => {
    let cancelled = false;
    void loadSchoolHint().then((hint) => {
      if (cancelled || hint === null) return;
      setRememberedSlug(hint);
      setSchoolSlug((current) => (current.length === 0 ? hint : current));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "authenticated") {
    return <Redirect href={principal === "staff" ? "/staff" : principal === "student" ? "/me" : "/students"} />;
  }

  const isStudent = mode === "student";

  // Collapse only when there is a remembered code AND it is still the value in
  // play. If the user has revealed the field, or edited it away from what was
  // remembered, the input stays — re-collapsing under someone mid-correction
  // would hide the thing they are trying to fix.
  //
  // Revealing deliberately KEEPS the current value rather than clearing it.
  // Deleting a wrong code costs one gesture; recovering a forgotten one is
  // impossible for a child, so the asymmetry decides it.
  const showCollapsedSchool = shouldCollapseSchoolField({
    isStudent,
    editing: editingSchool,
    remembered: rememberedSlug,
    current: schoolSlug,
  });

  const isStaff = mode === "staff";
  const canSubmit = challengeToken
    ? twoFactorCode.length === 6
    : isStudent
    ? schoolSlug.trim().length > 0 &&
      admissionNumber.trim().length > 0 &&
      password.length > 0
    : email.trim().length > 0 && password.length > 0;

  function switchMode(next: Mode) {
    // Clear the error when switching: a failure from the parent form is not
    // about the student form, and leaving it up reads as though the new form
    // has already been rejected before it was filled in.
    setError(null);
    setChallengeToken(null);
    setTwoFactorCode("");
    setMode(next);
  }

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      if (challengeToken) {
        await completeStaffTwoFactor(challengeToken, twoFactorCode);
      } else if (isStudent) {
        // Trimming/lowercasing of the school code and trimming of the
        // admission number also happen server-side in studentLoginSchema.
        // Doing it here too means the value the child sees in the box is the
        // value that gets sent — not a silently different one.
        await signInStudent({
          schoolSlug: schoolSlug.trim().toLowerCase(),
          admissionNumber: admissionNumber.trim(),
          password,
        });
      } else if (isStaff) {
        const challenge = await signInStaff({ email: email.trim().toLowerCase(), password });
        if (challenge) setChallengeToken(challenge);
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
                : isStaff
                  ? "Secure access for school staff."
                  : "Sign in to follow your child's progress."}
            </Body>
          </View>

          <View style={[styles.switcher, { borderColor: colors.border }]}>
            {(["guardian", "student", "staff"] as const).map((option) => {
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
                    {option === "guardian" ? "Parent" : option === "student" ? "Student" : "Staff"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {challengeToken ? (
            <TextInput
              value={twoFactorCode}
              onChangeText={setTwoFactorCode}
              placeholder="6-digit authenticator code"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              maxLength={6}
              editable={!submitting}
              style={inputStyle}
            />
          ) : isStudent ? (
            <>
              {/* A returning child on their own device sees two fields, not
                  three — the school code is the one credential nobody ever
                  tells them, so asking for it every time is asking for the
                  one thing they cannot supply.

                  It collapses rather than disappears: the code is still shown,
                  so a child can read it off the screen and a parent can check
                  it, and it is still submitted. Anyone whose school is wrong —
                  a switched device, a sibling at another school, a shared
                  handset — taps through to the full field. */}
              {showCollapsedSchool ? (
                <View style={styles.schoolSummary}>
                  <Text style={[styles.schoolSummaryText, { color: colors.mutedForeground }]}>
                    Signing in to{" "}
                    <Text style={[styles.schoolSummarySlug, { color: colors.foreground }]}>
                      {schoolSlug}
                    </Text>
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Change school"
                    disabled={submitting}
                    onPress={() => setEditingSchool(true)}
                    style={styles.schoolChange}
                  >
                    <Text style={[styles.schoolChangeText, { color: colors.primary }]}>
                      Not your school?
                    </Text>
                  </Pressable>
                </View>
              ) : (
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
              )}
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

          {!challengeToken ? <TextInput
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
          /> : null}

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
  schoolSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  schoolSummaryText: {
    flexShrink: 1,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  schoolSummarySlug: {
    fontFamily: fonts.sansSemibold,
  },
  schoolChange: {
    minHeight: 44, // the minimum comfortable tap target
    justifyContent: "center",
  },
  schoolChangeText: {
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
