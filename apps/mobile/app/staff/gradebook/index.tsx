import { useSyncExternalStore } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { staffTeacherScope } from "../../../src/lib/api/staff-attendance";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import {
  columnHasDrafts,
  getGradebookDraftsVersion,
  subscribeGradebookDrafts,
} from "../../../src/lib/staff/gradebook-drafts";
import { spacing } from "../../../src/theme/tokens";
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

// CP6a Gate 1 — which columns this teacher may enter marks for.
//
// The offer is `subjectsByArm`, NOT `classArms`. A form teacher sees their
// homeroom arm in `classArms` even when they teach no subject in it, and
// AssessmentService would 404 every column there. Offering such an arm would
// route a teacher to a screen that can only refuse them, so an arm appears
// here only with the subjects the server says this teacher teaches in it.
//
// Current term only, as on web: the term rides on /teacher-scope/me because
// teachers do not hold term.read.

export default function GradebookPickerScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";

  const scope = useQuery({
    queryKey: queryKeys.staffScope(schoolId, userId),
    queryFn: staffTeacherScope,
    enabled: authed && schoolId !== "" && userId !== "",
    staleTime: 60_000,
  });

  // Re-render when drafts change so the "unsaved marks" label is current. The
  // snapshot is a version number, not the drafts themselves.
  useSyncExternalStore(
    subscribeGradebookDrafts,
    getGradebookDraftsVersion,
    getGradebookDraftsVersion,
  );

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const data = scope.data;
  const term = data?.currentTerm ?? null;
  const columns = (data?.classArms ?? []).flatMap((arm) =>
    (data?.subjectsByArm[arm.id] ?? []).map((subject) => ({ arm, subject })),
  );

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Enter marks" }} />
      <Heading>Enter marks</Heading>
      {term ? <Body muted>{term.name}</Body> : null}

      <ScrollView contentContainerStyle={styles.content}>
        {scope.isPending && (
          <CenteredMessage>
            <Body muted>Loading your subjects…</Body>
          </CenteredMessage>
        )}

        {scope.isError && !data && (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load your subjects. Try again shortly.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void scope.refetch()} />
          </CenteredMessage>
        )}

        {data && !term && (
          <Notice tone="warning">
            No term is active. Ask your school administrator to set the current term before
            entering marks.
          </Notice>
        )}

        {data && term && columns.length === 0 && (
          <Notice tone="info">
            {data.classArms.length > 0
              ? "You aren't assigned to teach a subject yet. Marks are entered by the subject teacher. Ask your school administrator if this is wrong."
              : "You have no classes assigned yet. Ask your school administrator to assign your subjects."}
          </Notice>
        )}

        {term &&
          columns.map(({ arm, subject }) => {
            const unsaved = columnHasDrafts({
              schoolId,
              userId,
              termId: term.id,
              classArmId: arm.id,
              subjectId: subject.id,
            });
            return (
              <Card key={arm.id + subject.id} style={styles.card}>
                <View style={styles.text}>
                  <Body>{subject.name}</Body>
                  <Label>{arm.name}</Label>
                  {unsaved ? <Body muted>You have unsaved marks here.</Body> : null}
                </View>
                <Button
                  title={unsaved ? "Continue entering marks" : "Open"}
                  onPress={() => router.push(`/staff/gradebook/${arm.id}/${subject.id}`)}
                />
              </Card>
            );
          })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  card: { gap: spacing.sm },
  text: { gap: spacing.xs },
});
