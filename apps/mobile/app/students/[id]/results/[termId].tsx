import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { getResult } from "../../../../src/lib/api/portal";
import { queryKeys } from "../../../../src/lib/query/keys";
import { useSession } from "../../../../src/lib/auth/session";
import { spacing } from "../../../../src/theme/tokens";
import {
  Body,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../../../src/components/ui";
import { FreshnessLabel } from "../../../../src/components/freshness-label";
import { PrincipalRemark, ResultStanding } from "../../../../src/components/result-extras";
import { positionLabel } from "../../../../src/lib/results/result-extras";

// Phase 6 / Slice 4 — one released term, in full.
//
// Addressed by TERM, not by report-card id: a parent navigates by "last
// term", and the server's lookup includes the studentId, so a card belonging
// to another child cannot be addressed from here at all.
//
// D32 — this is the strongest cache in the app. A released card is frozen
// server-side by released-guard.ts, so once fetched it is correct forever.
// `staleTime: Infinity` is therefore not an optimisation gamble, it is a
// statement about the data: there is nothing to refetch. `gcTime` is long so
// it survives navigation, and the persister writes it to disk so it survives
// a restart on a phone with no signal.
//
// Position appears only when the school shows it to families
// (School.positionVisibleToFamilies, Phase 8 / CP6a); the API returns null
// otherwise, and a null renders as no row at all — a permanent em-dash would
// imply the school failed to fill it in.
//
// Note on D32 after CP6a: the CARD is frozen, but whether position is shown
// is a school setting that can change later. A card already cached keeps the
// answer it was fetched with until the cache is cleared; that is acceptable
// for a display preference, and is why the setting's page says changes apply
// "the next time they open their results" rather than instantly.

/** 7350 → "73.50%". */
function formatAverage(hundredths: number | null): string {
  if (hundredths === null) return "—";
  const whole = Math.trunc(hundredths / 100);
  const frac = Math.abs(hundredths % 100).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

export default function ResultDetailScreen() {
  const { id, termId } = useLocalSearchParams<{ id: string; termId: string }>();
  const { status } = useSession();

  const studentId = typeof id === "string" ? id : "";
  const term = typeof termId === "string" ? termId : "";

  const resultQuery = useQuery({
    queryKey: queryKeys.result(studentId, term),
    queryFn: () => getResult(studentId, term),
    enabled: studentId.length > 0 && term.length > 0,
    staleTime: Infinity,
  });

  if (status === "guest") return <Redirect href="/login" />;

  const result = resultQuery.data;

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
                {/* Only when the school shows position to families (CP6a);
                    otherwise no metric at all, never a dash. */}
                {positionLabel(result.overallPosition) ? (
                  <View style={styles.metric}>
                    <Label>Position</Label>
                    <Body>{positionLabel(result.overallPosition)}</Body>
                  </View>
                ) : null}
              </View>
            </Card>

            <ResultStanding result={result} />

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
                      {positionLabel(s.subjectPosition) ? <Label>{positionLabel(s.subjectPosition)}</Label> : null}
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

            <PrincipalRemark result={result} />
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
