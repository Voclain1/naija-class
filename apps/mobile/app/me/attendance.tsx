import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { StudentAttendanceTermDto } from "@school-kit/types";

import { listStudentAttendance } from "../../src/lib/api/student-portal";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { formatHundredths } from "../../src/lib/format";
import { spacing } from "../../src/theme/tokens";
import {
  Body,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../src/components/ui";
import { FreshnessLabel } from "../../src/components/freshness-label";

// A student's own attendance, by term.
//
// Cached far less aggressively than results: a released report card is frozen
// server-side and cannot change, but attendance moves every school day, so a
// day-old figure here would be quietly wrong rather than merely incomplete.
// The freshness line carries the rest of that story.
const ONE_HOUR_MS = 1000 * 60 * 60;

export default function MyAttendanceScreen() {
  const { status, principal } = useSession();

  const query = useQuery({
    queryKey: queryKeys.myAttendance,
    queryFn: listStudentAttendance,
    enabled: status === "authenticated" && principal === "student",
    staleTime: ONE_HOUR_MS,
  });

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") {
    return <Redirect href="/students" />;
  }

  const terms: StudentAttendanceTermDto[] = query.data?.data ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "My attendance" }} />
      <ScrollView contentContainerStyle={styles.content}>
        {query.isPending && (
          <CenteredMessage>
            <Body muted>Loading your attendance…</Body>
          </CenteredMessage>
        )}

        {query.isError && !query.data && (
          <CenteredMessage>
            <Notice tone="danger">
              We couldn&apos;t load your attendance. Try again shortly.
            </Notice>
          </CenteredMessage>
        )}

        {query.data && (
          <>
            <FreshnessLabel updatedAt={query.dataUpdatedAt} />

            {terms.length === 0 ? (
              <Card>
                <Heading>Nothing marked yet</Heading>
                <Body>
                  Once your school starts marking the register, your attendance
                  will appear here.
                </Body>
              </Card>
            ) : (
              terms.map((t) => (
                <Card key={t.termId}>
                  <Heading>{t.termName}</Heading>
                  <Body muted>{t.academicYearLabel}</Body>

                  <View style={styles.headline}>
                    <Label>Attendance</Label>
                    <Body>{formatHundredths(t.attendanceRate)}</Body>
                    <Body muted>{t.daysMarked} days marked</Body>
                  </View>

                  {/* Present/late/absent/excused shown alongside the rate, not
                      instead of it: the rate answers "how am I doing" and the
                      counts answer "why", and a child querying the number with
                      a teacher needs both. */}
                  <View style={styles.row}>
                    <View style={styles.metric}>
                      <Label>Present</Label>
                      <Body>{t.presentCount}</Body>
                    </View>
                    <View style={styles.metric}>
                      <Label>Late</Label>
                      <Body>{t.lateCount}</Body>
                    </View>
                    <View style={styles.metric}>
                      <Label>Absent</Label>
                      <Body>{t.absentCount}</Body>
                    </View>
                    <View style={styles.metric}>
                      <Label>Excused</Label>
                      <Body>{t.excusedCount}</Body>
                    </View>
                  </View>
                </Card>
              ))
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
  headline: { marginTop: spacing.sm, gap: spacing.xs },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  metric: { alignItems: "flex-start" },
});
