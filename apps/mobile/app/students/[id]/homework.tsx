import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { guardianHomework } from "../../../src/lib/api/portal";
import { queryKeys } from "../../../src/lib/query/keys";
import { HomeworkList } from "../../../src/components/homework-list";
import { useSession } from "../../../src/lib/auth/session";
import { serverToday } from "../../../src/lib/staff/server-date";
import { addDays } from "@school-kit/types";
import { useTheme } from "../../../src/theme/theme-provider";
import { spacing } from "../../../src/theme/tokens";
import { Body, Button, CenteredMessage, Notice, Screen } from "../../../src/components/ui";
import { EmptyState } from "../../../src/components/layout";
import { FreshnessLabel } from "../../../src/components/freshness-label";

// One child's homework, for a parent (docs/modules/the-school-day.md Part B).
//
// The same renderer the student screen uses, from the guardian endpoint — the
// server proves the parent is linked to this child (withGuardian), because RLS
// knows school_id and nothing about who may see whom.
//
// Persisted and readable offline on purpose: "questions 1 to 10 by Friday" is
// exactly what a child needs at a kitchen table with no signal, and the
// freshness label keeps a cached list honest about when it was fetched.
//
// Nothing is submitted here (B7). A child reads what to do and does it on
// paper, which is what every one of these schools actually does.

const ONE_HOUR_MS = 1000 * 60 * 60;

export default function ChildHomeworkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const studentId = typeof id === "string" ? id : "";
  const { status, principal } = useSession();
  const { colors } = useTheme();

  // The school's day where we know it. This drives the GROUP HEADINGS only —
  // whether a piece of work is overdue is the server's judgement, sent per
  // item, so a device with a wrong clock can mislabel a heading but can never
  // accuse a child of being late.
  const today = serverToday() ?? new Date().toISOString().slice(0, 10);
  const tomorrow = addDays(today, 1);

  const query = useQuery({
    queryKey: queryKeys.guardianHomework(studentId),
    queryFn: () => guardianHomework(studentId),
    enabled: status === "authenticated" && principal === "guardian" && studentId !== "",
    staleTime: ONE_HOUR_MS,
  });

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal === "student") return <Redirect href="/me/homework" />;

  const data = query.data;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "Homework" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={colors.primary}
          />
        }
      >
        {query.isPending && (
          <CenteredMessage>
            <Body muted>Loading…</Body>
          </CenteredMessage>
        )}

        {query.isError && !data && (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load this homework.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void query.refetch()} />
          </CenteredMessage>
        )}

        {data && (
          <>
            <FreshnessLabel updatedAt={query.dataUpdatedAt} />
            {data.data.length === 0 ? (
              <EmptyState
                icon="book-outline"
                title="Nothing due"
                body="Homework your child&apos;s teachers set will appear here."
              />
            ) : (
              <HomeworkList items={data.data} today={today} tomorrow={tomorrow} />
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
});
