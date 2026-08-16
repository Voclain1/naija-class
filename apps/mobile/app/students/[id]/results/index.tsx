import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Link, Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { ReleasedResultSummaryDto } from "@school-kit/types";

import { listResults } from "../../../../src/lib/api/portal";
import { queryKeys } from "../../../../src/lib/query/keys";
import { useSession } from "../../../../src/lib/auth/session";
import { spacing } from "../../../../src/theme/tokens";
import {
  Body,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Screen,
} from "../../../../src/components/ui";
import { FreshnessLabel } from "../../../../src/components/freshness-label";

// Phase 6 / Slice 4 — a parent's list of their child's released results.
//
// D32: released cards are immutable on the server, so this is the best cache
// in the app — a stale entry cannot be wrong, only incomplete. staleTime is
// long and there is no aggressive refetch; a parent on a bad connection at
// the school gate should see last term's results instantly.
//
// D33: an empty list is the NORMAL state for most of the year, not an error
// and not a loading state that never resolves. It gets real copy.

/** 7350 → "73.50%". Mirrors the web formatter; hundredths never become floats. */
function formatAverage(hundredths: number | null): string {
  if (hundredths === null) return "—";
  const whole = Math.trunc(hundredths / 100);
  const frac = Math.abs(hundredths % 100).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

export default function ResultsListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status } = useSession();
  const studentId = typeof id === "string" ? id : "";

  const resultsQuery = useQuery({
    queryKey: queryKeys.results(studentId),
    queryFn: () => listResults(studentId),
    enabled: studentId.length > 0,
    staleTime: ONE_DAY_MS,
  });

  if (status === "guest") return <Redirect href="/login" />;

  const results: ReleasedResultSummaryDto[] = resultsQuery.data?.data ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: "Results" }} />
      <ScrollView contentContainerStyle={styles.content}>
        {resultsQuery.isPending && <CenteredMessage>Loading results…</CenteredMessage>}

        {resultsQuery.isError && !resultsQuery.data && (
          <CenteredMessage>
            We couldn&apos;t load results. Pull down or try again shortly.
          </CenteredMessage>
        )}

        {resultsQuery.data && (
          <>
            <FreshnessLabel updatedAt={resultsQuery.dataUpdatedAt} />

            {results.length === 0 ? (
              // Deliberately not an error and not an empty box. Most families
              // will see this for most of the year, so it explains itself.
              <Card>
                <Heading>Nothing released yet</Heading>
                <Body>
                  When the school publishes a term&apos;s report card, it will
                  appear here.
                </Body>
              </Card>
            ) : (
              results.map((r) => (
                <Link
                  key={r.reportCardId}
                  href={`/students/${studentId}/results/${r.termId}`}
                  asChild
                >
                  <Pressable>
                    <Card>
                      <Heading>{r.termName}</Heading>
                      <Body muted>{r.academicYearLabel}</Body>
                      <View style={styles.row}>
                        <View>
                          <Label>Average</Label>
                          <Body>{formatAverage(r.overallAverage)}</Body>
                        </View>
                        <View>
                          <Label>Subjects</Label>
                          <Body>{r.subjectsCount ?? "—"}</Body>
                        </View>
                        <View>
                          <Label>Class</Label>
                          <Body>{r.classArmName}</Body>
                        </View>
                      </View>
                    </Card>
                  </Pressable>
                </Link>
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
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
});
