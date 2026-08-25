import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { staffTeacherScope } from "../../src/lib/api/staff-attendance";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { spacing } from "../../src/theme/tokens";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../src/components/ui";

// Staff home — CP2 lists the arms this teacher may actually mark.
//
// "May actually mark" is `formTeacherArmIds`, NOT `classArms`. The two differ
// and the difference is the whole point: `classArms` is the union of homeroom
// arms and subject-assignment arms, and AttendanceService gives a SUBJECT
// teacher of an arm a 403 on daily attendance. Offering such an arm here would
// route a teacher to a screen that can only refuse them. A teacher with no
// homeroom therefore sees an empty state that names the reason rather than a
// blank list — the arms they teach are real, they simply are not registers
// this person owns.

export default function StaffHomeScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";

  const scope = useQuery({
    queryKey: queryKeys.staffScope(schoolId, userId),
    queryFn: staffTeacherScope,
    enabled: authed && schoolId !== "" && userId !== "",
    // Never persisted (the "staff" key prefix bars it) and cheap to refetch,
    // so this stays short-lived: a mid-term homeroom reassignment should show
    // up on the next visit, not after a cache expiry nobody can see.
    staleTime: 60_000,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const data = scope.data;
  const markableArms = (data?.classArms ?? []).filter((arm) =>
    (data?.formTeacherArmIds ?? []).includes(arm.id),
  );
  const teachesOtherArms = (data?.classArms.length ?? 0) > markableArms.length;

  return (
    <Screen>
      <Heading>Attendance</Heading>
      <Body muted>
        {staff ? `Signed in as ${staff.user.firstName}.` : "Restoring staff access…"}
      </Body>

      <ScrollView contentContainerStyle={styles.content}>
        {scope.isPending && (
          <CenteredMessage>
            <Body muted>Loading your classes…</Body>
          </CenteredMessage>
        )}

        {scope.isError && !data && (
          <CenteredMessage>
            <Notice tone="danger">
              We couldn&apos;t load your classes. Pull down or try again shortly.
            </Notice>
            <Button title="Try again" variant="secondary" onPress={() => void scope.refetch()} />
          </CenteredMessage>
        )}

        {data && markableArms.length === 0 && (
          <Notice tone="info">
            {teachesOtherArms
              ? "You teach subjects in this school, but you are not the form teacher of any class. Daily attendance is marked by the form teacher."
              : "You have no classes assigned yet. Ask your school administrator to assign you as a form teacher."}
          </Notice>
        )}

        {markableArms.map((arm) => (
          <Card key={arm.id} style={styles.armCard}>
            <View style={styles.armText}>
              <Body>{arm.name}</Body>
              <Label>{arm.classLevelName}</Label>
            </View>
            <Button
              title="Open register"
              onPress={() => router.push(`/staff/attendance/${arm.id}`)}
            />
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  armCard: { gap: spacing.sm },
  armText: { gap: spacing.xs },
});
