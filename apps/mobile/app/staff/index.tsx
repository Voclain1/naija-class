import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { staffTeacherScope } from "../../src/lib/api/staff-attendance";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { hasPermission } from "../../src/lib/auth/permissions";
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

  const canSeeCollections = hasPermission(staff?.permissions ?? [], "finance.dashboard.read");
  // CP6a — offered on the server's own answer to "what do I teach", not on a
  // role name: a column appears only where subjectsByArm lists a subject.
  const canEnterMarks = hasPermission(staff?.permissions ?? [], "assessment-score.create");
  const canWriteLessonNotes = hasPermission(staff?.permissions ?? [], "lesson-plan.create");

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
  const teachesSubjects = Object.values(data?.subjectsByArm ?? {}).some(
    (subjects) => subjects.length > 0,
  );

  return (
    <Screen>
      <Heading>Attendance</Heading>
      <Body muted>
        {staff ? `Signed in as ${staff.user.firstName}.` : "Restoring staff access…"}
      </Body>

      <ScrollView contentContainerStyle={styles.content}>
        {/*
          CP3 — collections, offered on PERMISSION rather than role name. A
          bursar holds finance.dashboard.read; so does an owner (via "*"). A
          teacher holds neither and is never shown a screen that could only
          403 at them, which is the same rule the arm list below applies to
          form-teacher arms.
        */}
        {canWriteLessonNotes && (
          <Card style={styles.armCard}>
            <View style={styles.armText}>
              <Body>Lesson notes</Body>
              <Label>Write a lesson note with AI, then edit it</Label>
            </View>
            <Button title="Open lesson notes" onPress={() => router.push("/staff/lesson-notes")} />
          </Card>
        )}

        <Card style={styles.armCard}>
          <View style={styles.armText}>
            <Body>My classes</Body>
            <Label>Who is in each class you teach</Label>
          </View>
          <Button title="Open classes" onPress={() => router.push("/staff/classes")} />
        </Card>

        {canEnterMarks && teachesSubjects && (
          <Card style={styles.armCard}>
            <View style={styles.armText}>
              <Body>Marks</Body>
              <Label>Enter test and exam marks for the subjects you teach</Label>
            </View>
            <Button title="Enter marks" onPress={() => router.push("/staff/gradebook")} />
          </Card>
        )}

        {canSeeCollections && (
          <Card style={styles.armCard}>
            <View style={styles.armText}>
              <Body>Collections</Body>
              <Label>Fees collected, outstanding and who owes</Label>
            </View>
            <Button title="Open collections" onPress={() => router.push("/staff/collections")} />
          </Card>
        )}

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
            {/* CP7: the overall report card comment is the form teacher's, so
                it is offered exactly where form-teacher arms already are. */}
            <Button
              title="Report card comments"
              variant="secondary"
              onPress={() => router.push(`/staff/report-cards/${arm.id}`)}
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
