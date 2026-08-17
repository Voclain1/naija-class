import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Link, Redirect } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { getStudentMe } from "../../src/lib/api/student-portal";
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
import { FreshnessLabel } from "../../src/components/freshness-label";

// The student principal's home screen.
//
// WHY THIS FETCHES ITS OWN PROFILE: the session persists the token but
// deliberately NOT the profile (session.tsx — a name and school written to
// plaintext storage to save one request is a bad trade on a shared handset).
// So after a cold start the app knows it is signed in as a student but not
// which one. `session.student` is populated only for the lifetime of the
// process that signed in; this query is what makes a relaunch work.
export default function MyHomeScreen() {
  const { status, principal, student: sessionStudent, signOut } = useSession();

  const meQuery = useQuery({
    queryKey: queryKeys.me,
    queryFn: getStudentMe,
    enabled: status === "authenticated" && principal === "student",
  });

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") {
    return <Redirect href="/students" />;
  }

  // Prefer the freshly fetched profile, fall back to whatever the sign-in put
  // in memory. Either can be absent on a cold, offline start.
  const student = meQuery.data?.student ?? sessionStudent;
  const school = meQuery.data?.school ?? null;
  const enrollment = student?.currentEnrollment ?? null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Heading>
            {student ? `Hello, ${student.firstName}` : "Your school work"}
          </Heading>
          {school ? <Body muted>{school.name}</Body> : null}
          <FreshnessLabel updatedAt={meQuery.dataUpdatedAt} />
        </View>

        {meQuery.isPending && !student && (
          <CenteredMessage>
            <Body muted>Loading…</Body>
          </CenteredMessage>
        )}

        {meQuery.isError && !student && (
          <CenteredMessage>
            <Notice tone="danger">
              We couldn&apos;t load your details just now.
            </Notice>
          </CenteredMessage>
        )}

        {student && (
          <Card>
            <Label>Admission number</Label>
            <Body>{student.admissionNumber}</Body>
            {/* The two things a child needs to sign in again, shown together
                and while they are still signed in — the app remembers the
                school code for them, but a new or reset phone will not, and
                nobody else in their life is likely to know it. */}
            {school ? (
              <>
                <Label>School code</Label>
                <Body>{school.slug}</Body>
              </>
            ) : null}
            {enrollment ? (
              <>
                <Label>Class</Label>
                <Body>
                  {enrollment.classArm.classLevel.name} ·{" "}
                  {enrollment.classArm.name}
                </Body>
              </>
            ) : null}
          </Card>
        )}

        <Link href="/me/results" asChild>
          <Pressable>
            <Card>
              <Heading>My results</Heading>
              <Body muted>Report cards your school has released.</Body>
            </Card>
          </Pressable>
        </Link>

        <Link href="/me/attendance" asChild>
          <Pressable>
            <Card>
              <Heading>My attendance</Heading>
              <Body muted>How many days you have been in school.</Body>
            </Card>
          </Pressable>
        </Link>

        <Link href="/me/fees" asChild>
          <Pressable>
            <Card>
              <Heading>My fees</Heading>
              <Body muted>What your school has invoiced this year.</Body>
            </Card>
          </Pressable>
        </Link>

        <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
  header: { gap: spacing.xs },
});
