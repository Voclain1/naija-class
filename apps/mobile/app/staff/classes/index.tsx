import { ScrollView, StyleSheet } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { staffTeacherScope } from "../../../src/lib/api/staff-attendance";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { spacing } from "../../../src/theme/tokens";
import {
  EmptyState,
  ListRow,
  ScreenHeader,
  Skeleton,
} from "../../../src/components/layout";
import {
  Button,
  CenteredMessage,
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
      <ScreenHeader title="My classes" />

      <ScrollView contentContainerStyle={styles.content}>
        {scope.isPending && <Skeleton lines={3} />}

        {scope.isError && !data && (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load your classes. Try again shortly.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void scope.refetch()} />
          </CenteredMessage>
        )}

        {data && arms.length === 0 && (
          <EmptyState
            icon="people-outline"
            title="No classes yet"
            body="Your school hasn't assigned you a class. Ask your administrator to set that up."
          />
        )}

        {arms.map((arm) => {
          const isFormTeacher = (data?.formTeacherArmIds ?? []).includes(arm.id);
          const subjects = data?.subjectsByArm[arm.id] ?? [];
          return (
            <ListRow
              key={arm.id}
              icon={isFormTeacher ? "ribbon-outline" : "people-outline"}
              title={arm.name}
              subtitle={`${arm.classLevelName}${
                isFormTeacher ? " · form teacher" : ""
              }${subjects.length > 0 ? ` · ${subjects.map((s) => s.name).join(", ")}` : ""}`}
              onPress={() => router.push(`/staff/classes/${arm.id}`)}
            />
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
