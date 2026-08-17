import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { getStudentResult } from "../../../src/lib/api/student-portal";
import { queryKeys } from "../../../src/lib/query/keys";
import { useSession } from "../../../src/lib/auth/session";
import { spacing } from "../../../src/theme/tokens";
import {
  Body,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../../src/components/ui";
import { FreshnessLabel } from "../../../src/components/freshness-label";

// A student's own report card for one term. Mirrors the guardian screen at
// app/students/[id]/results/[termId], minus the student id — the term id is
// the only parameter, and the session decides whose card it is.

/** 7350 → "73.50%". Mirrors the web formatter; hundredths never become floats. */
function formatAverage(hundredths: number | null): string {
  if (hundredths === null) return "—";
  const whole = Math.trunc(hundredths / 100);
  const frac = Math.abs(hundredths % 100).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

export default function MyResultDetailScreen() {
  const { termId } = useLocalSearchParams<{ termId: string }>();
  const { status, principal } = useSession();
  const term = typeof termId === "string" ? termId : "";

  const resultQuery = useQuery({
    queryKey: queryKeys.myResult(term),
    queryFn: () => getStudentResult(term),
    enabled:
      term.length > 0 && status === "authenticated" && principal === "student",
    staleTime: ONE_DAY_MS,
  });

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") {
    return <Redirect href="/students" />;
  }

  const result = resultQuery.data ?? null;

  return (
    <Screen>
      <Stack.Screen
        options={{ headerShown: true, title: result?.termName ?? "Results" }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {resultQuery.isPending && (
          <CenteredMessage>
            <Body muted>Loading…</Body>
          </CenteredMessage>
        )}

        {resultQuery.isError && !result && (
          <CenteredMessage>
            <Notice tone="danger">
              We couldn&apos;t load this report card. Try again shortly.
            </Notice>
          </CenteredMessage>
        )}

        {result && (
          <>
            <FreshnessLabel updatedAt={resultQuery.dataUpdatedAt} />

            <Card>
              <Heading>
                {result.student.firstName} {result.student.lastName}
              </Heading>
              <Body muted>
                {result.termName} · {result.academicYearLabel} ·{" "}
                {result.classArmName}
              </Body>
            </Card>

            <Card>
              <View style={styles.summary}>
                <View style={styles.metric}>
                  <Label>Average</Label>
                  <Body>{formatAverage(result.overallAverage)}</Body>
                </View>
                <View style={styles.metric}>
                  <Label>Total</Label>
                  <Body>{result.overallTotal ?? "—"}</Body>
                </View>
                <View style={styles.metric}>
                  <Label>Subjects</Label>
                  <Body>{result.subjectsCount ?? "—"}</Body>
                </View>
              </View>
            </Card>

            <Card>
              <Heading>Subjects</Heading>
              {result.subjects.length === 0 ? (
                <Body muted>No subject scores were recorded for this term.</Body>
              ) : (
                result.subjects.map((s) => (
                  <View key={s.subjectId} style={styles.subjectRow}>
                    <View style={styles.subjectName}>
                      <Body>{s.subjectName}</Body>
                      {s.remark ? <Body muted>{s.remark}</Body> : null}
                    </View>
                    <View style={styles.subjectScore}>
                      <Body>{s.totalScore}</Body>
                      {s.letterGrade ? <Label>{s.letterGrade}</Label> : null}
                    </View>
                  </View>
                ))
              )}
            </Card>

            {result.formTeacherComment ? (
              <Card>
                <Heading>Form teacher&apos;s comment</Heading>
                <Body>{result.formTeacherComment}</Body>
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
  summary: { flexDirection: "row", justifyContent: "space-between" },
  metric: { alignItems: "flex-start" },
  subjectRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  subjectName: { flex: 1 },
  subjectScore: { alignItems: "flex-end" },
});
