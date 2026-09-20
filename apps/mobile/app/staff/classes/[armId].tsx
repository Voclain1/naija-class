import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { TeacherRosterStudentDto } from "@school-kit/types";

import { staffArmRoster, staffTeacherScope } from "../../../src/lib/api/staff-attendance";
import { ApiError } from "../../../src/lib/api/client";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { useTheme } from "../../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../../src/theme/tokens";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../../src/components/ui";

// CP7 (3) — one class's students.
//
// The roster DTO is deliberately narrow on the server: name, admission number,
// gender, photo and status, and NOT medical notes, address, date of birth or
// contact details. This screen shows what it is given and asks for nothing
// more — a phone in a staffroom is the last place to widen a PII surface.
//
// A withdrawn or graduated student still appears, labelled, because a teacher
// looking for a child who left needs to see that they left rather than an
// empty result.

function fullName(student: TeacherRosterStudentDto): string {
  return [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
}

export default function ClassRosterScreen() {
  const { colors } = useTheme();
  const { armId } = useLocalSearchParams<{ armId: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "" && !!armId;

  const [search, setSearch] = useState("");

  const scope = useQuery({
    queryKey: queryKeys.staffScope(schoolId, userId),
    queryFn: staffTeacherScope,
    enabled: ready,
    staleTime: 60_000,
  });

  const roster = useQuery({
    queryKey: queryKeys.staffRoster(schoolId, userId, armId ?? ""),
    queryFn: () => staffArmRoster(armId as string),
    enabled: ready,
    staleTime: 60_000,
  });

  const students = useMemo(() => roster.data?.data ?? [], [roster.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return students;
    return students.filter(
      (student) =>
        fullName(student).toLowerCase().includes(needle) ||
        student.admissionNumber.toLowerCase().includes(needle),
    );
  }, [students, search]);

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const arm = scope.data?.classArms.find((a) => a.id === armId) ?? null;
  const outOfScope = roster.error instanceof ApiError && roster.error.status === 404;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: arm?.name ?? "Class" }} />
      <Heading>{arm?.name ?? "Class"}</Heading>
      {arm ? <Body muted>{arm.classLevelName}</Body> : null}

      {outOfScope ? (
        <Notice tone="info">This isn&apos;t one of your classes.</Notice>
      ) : (
        <>
          {students.length > 0 && (
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name or admission number"
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              accessibilityLabel="Search students"
              style={[
                styles.search,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            />
          )}

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {roster.isPending && (
              <CenteredMessage>
                <Body muted>Loading students…</Body>
              </CenteredMessage>
            )}

            {roster.isError && !roster.data && !outOfScope && (
              <CenteredMessage>
                <Notice tone="danger">We couldn&apos;t load this class. Try again shortly.</Notice>
                <Button
                  title="Try again"
                  variant="secondary"
                  onPress={() => void roster.refetch()}
                />
              </CenteredMessage>
            )}

            {roster.data && students.length === 0 && (
              <Notice tone="info">No students are enrolled in this class yet.</Notice>
            )}

            {roster.data && students.length > 0 && filtered.length === 0 && (
              <Notice tone="info">No student matches “{search.trim()}”.</Notice>
            )}

            {filtered.map((student) => (
              <Card key={student.id} style={styles.row}>
                <View style={styles.text}>
                  <Body>{fullName(student)}</Body>
                  <Label>
                    {student.admissionNumber}
                    {student.status === "ACTIVE" ? "" : ` · ${student.status.toLowerCase()}`}
                  </Label>
                </View>
              </Card>
            ))}

            {filtered.length > 0 ? (
              <Label>
                {filtered.length} student{filtered.length === 1 ? "" : "s"}
                {filtered.length === students.length ? "" : ` of ${students.length}`}
              </Label>
            ) : null}
          </ScrollView>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingVertical: spacing.md },
  row: { gap: spacing.xs },
  text: { gap: spacing.xs },
  search: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    fontFamily: fonts.sans,
    fontSize: fontSizes.body,
  },
});
