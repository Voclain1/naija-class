import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Link, Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { ReleasedResultSummaryDto } from "@school-kit/types";

import { listStudentResults } from "../../../src/lib/api/student-portal";
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

// Phase 6 — a student's own released results.
//
// The guardian equivalent at app/students/[id]/results is the template, and
// the caching reasoning carries over unchanged (D32: a released card is
// immutable server-side, so a stale entry cannot be wrong, only incomplete;
// D33: an empty list is the normal state for most of the year).
//
// What does NOT carry over is the student id. There is none in this route,
// none in the request, and none in the query key — the session resolves the
// student server-side. That is the whole point of the /student-portal/me/*
// shape (phase-6.md §8).

/** 7350 → "73.50%". Mirrors the web formatter; hundredths never become floats. */
function formatAverage(hundredths: number | null): string {
  if (hundredths === null) return "—";
  const whole = Math.trunc(hundredths / 100);
  const frac = Math.abs(hundredths % 100).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

export default function MyResultsScreen() {
  const { status, principal } = useSession();

  const resultsQuery = useQuery({
    queryKey: queryKeys.myResults,
    queryFn: listStudentResults,
    enabled: status === "authenticated" && principal === "student",
    staleTime: ONE_DAY_MS,
  });

  if (status === "guest") return <Redirect href="/login" />;
  // A guardian who somehow lands here goes to their own surface rather than
  // being shown an empty screen: this route's queries are disabled for them,
  // so it would otherwise render as permanently loading.
  if (status === "authenticated" && principal !== "student") {
    return <Redirect href="/students" />;
  }

  const results: ReleasedResultSummaryDto[] = resultsQuery.data?.data ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "My results" }} />
      <ScrollView contentContainerStyle={styles.content}>
        {resultsQuery.isPending && (
          <CenteredMessage>
            <Body muted>Loading your results…</Body>
          </CenteredMessage>
        )}

        {resultsQuery.isError && !resultsQuery.data && (
          <CenteredMessage>
            <Notice tone="danger">
              We couldn&apos;t load your results. Pull down or try again
              shortly.
            </Notice>
          </CenteredMessage>
        )}

        {resultsQuery.data && (
          <>
            <FreshnessLabel updatedAt={resultsQuery.dataUpdatedAt} />

            {results.length === 0 ? (
              <Card>
                <Heading>Nothing released yet</Heading>
                <Body>
                  When your school publishes a term&apos;s report card, it will
                  appear here.
                </Body>
              </Card>
            ) : (
              results.map((r) => (
                <Link key={r.reportCardId} href={`/me/results/${r.termId}`} asChild>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View ${r.termName} results`}
                  >
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
