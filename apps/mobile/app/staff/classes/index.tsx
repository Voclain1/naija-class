import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { staffTeacherScope } from "../../../src/lib/api/staff-attendance";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
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

// CP7 (3) — the teacher's classes.
//
// Every arm in scope is listed, not just form-teacher arms: a subject teacher
// has a legitimate reason to look up who is in a class they teach, and the
// roster endpoint is scoped to exactly the arms the server already put in
// `classArms`. What each arm offers differs, and that is said on the card
// rather than discovered by tapping into a 403.

export default function ClassesScreen() {
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

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const data = scope.data;
  const arms = data?.classArms ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "My classes" }} />
      <Heading>My classes</Heading>

      <ScrollView contentContainerStyle={styles.content}>
        {scope.isPending && (
          <CenteredMessage>
            <Body muted>Loading your classes…</Body>
          </CenteredMessage>
        )}

        {scope.isError && !data && (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load your classes. Try again shortly.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void scope.refetch()} />
          </CenteredMessage>
        )}

        {data && arms.length === 0 && (
          <Notice tone="info">
            You have no classes assigned yet. Ask your school administrator to assign you.
          </Notice>
        )}

        {arms.map((arm) => {
          const isFormTeacher = (data?.formTeacherArmIds ?? []).includes(arm.id);
          const subjects = data?.subjectsByArm[arm.id] ?? [];
          return (
            <Card key={arm.id} style={styles.card}>
              <View style={styles.text}>
                <Body>{arm.name}</Body>
                <Label>{arm.classLevelName}</Label>
                <Label>
                  {isFormTeacher ? "You are the form teacher. " : ""}
                  {subjects.length > 0
                    ? `You teach ${subjects.map((s) => s.name).join(", ")}.`
                    : "You teach no subject in this class."}
                </Label>
              </View>
              <Button
                title="View students"
                onPress={() => router.push(`/staff/classes/${arm.id}`)}
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
