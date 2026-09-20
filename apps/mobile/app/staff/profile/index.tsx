import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput } from "react-native";
import { Redirect } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { staffMyProfile, staffUpdateMyProfile } from "../../../src/lib/api/staff-curriculum";
import { ApiError, ApiNetworkError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import { ScreenHeader, SectionHeader, Skeleton } from "../../../src/components/layout";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Label,
  Notice,
  Screen,
} from "../../../src/components/ui";

// CP7 (6) — the teacher's own profile.
//
// Self-service is deliberately NARROW, and the division is not arbitrary: a
// teacher may edit what they know about themselves (specialty,
// qualifications), while staff number, NUT number and joining date are the
// SCHOOL's records about them and stay admin-only. Those are shown read-only
// rather than hidden, because a teacher checking their own staff number is a
// reasonable thing to do on a phone.
//
// Not a profile "settings" screen: sign-out already lives on the staff home,
// and passwords and 2FA are web-only by the header's own list.

function describeFailure(error: unknown): string {
  if (error instanceof ApiNetworkError) {
    return "Your phone couldn't reach the server. Nothing was saved — try again when you have signal.";
  }
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return "Your school hasn't set up a staff record for you yet. Ask your administrator.";
    }
    return error.message || "That could not be saved.";
  }
  return "That could not be saved.";
}

export default function ProfileScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "";

  const profileKey = queryKeys.staffProfile(schoolId, userId);
  const profile = useQuery({
    queryKey: profileKey,
    queryFn: staffMyProfile,
    enabled: ready,
    staleTime: 60_000,
  });

  const [specialty, setSpecialty] = useState<string | null>(null);
  const [qualifications, setQualifications] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      staffUpdateMyProfile({
        // An emptied field is sent as null — the schema is nullable precisely
        // so "I have no specialty recorded" can be expressed, rather than
        // leaving stale text no one can clear.
        specialty: specialty === null ? undefined : specialty.trim() === "" ? null : specialty.trim(),
        qualifications:
          qualifications === null
            ? undefined
            : qualifications.trim() === ""
              ? null
              : qualifications.trim(),
      }),
    onMutate: () => {
      setFailure(null);
      setNotice(null);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(profileKey, updated);
      setSpecialty(null);
      setQualifications(null);
      setNotice("Saved.");
    },
    onError: (error: unknown) => setFailure(describeFailure(error)),
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = null;
  const data = profile.data;

  if (profile.isPending || (profile.isError && !data)) {
    return (
      <Screen>
        {header}
        <CenteredMessage>
          {profile.isError ? (
            <>
              <Notice tone="danger">{describeFailure(profile.error)}</Notice>
              <Button title="Try again" variant="secondary" onPress={() => void profile.refetch()} />
            </>
          ) : (
            <Skeleton lines={3} />
          )}
        </CenteredMessage>
      </Screen>
    );
  }

  const specialtyValue = specialty ?? data?.specialty ?? "";
  const qualificationsValue = qualifications ?? data?.qualifications ?? "";
  const edited =
    (specialty !== null && specialty !== (data?.specialty ?? "")) ||
    (qualifications !== null && qualifications !== (data?.qualifications ?? ""));

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScreenHeader
          title={staff ? `${staff.user.firstName} ${staff.user.lastName}` : "My profile"}
          subtitle={staff?.school.name ?? null}
        />

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Card style={styles.card}>
            <Label>Specialty</Label>
            <TextInput
              value={specialtyValue}
              onChangeText={setSpecialty}
              placeholder="e.g. Mathematics"
              placeholderTextColor={colors.mutedForeground}
              maxLength={200}
              accessibilityLabel="Specialty"
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            />

            <Label>Qualifications</Label>
            <TextInput
              value={qualificationsValue}
              onChangeText={setQualifications}
              multiline
              placeholder="e.g. B.Ed Mathematics, University of Ibadan"
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel="Qualifications"
              style={[
                styles.textarea,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            />

            <Button
              title="Save"
              loading={save.isPending}
              disabled={!edited || save.isPending}
              onPress={() => save.mutate()}
            />
          </Card>

          {notice ? <Notice tone="info">{notice}</Notice> : null}
          {failure ? <Notice tone="danger">{failure}</Notice> : null}

          {/* The school's records about the teacher: readable, not editable. */}
          <Card style={styles.card}>
            <SectionHeader title="Your school's record" />
            <Body>Staff number: {data?.staffNumber ?? "—"}</Body>
            <Body>NUT number: {data?.nutNumber ?? "—"}</Body>
            <Body>
              Joined:{" "}
              {data?.joinedAt ? new Date(data.joinedAt).toLocaleDateString() : "—"}
            </Body>
            <Label>
              Your school keeps these. Ask your administrator if anything here is wrong.
            </Label>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { gap: spacing.md, paddingVertical: spacing.md },
  card: { gap: spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
  textarea: {
    minHeight: 100,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    textAlignVertical: "top",
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
});
