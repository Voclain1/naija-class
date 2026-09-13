import { useMemo } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { defaultCalendarWindow } from "@school-kit/types";

import { getStudentCalendar } from "../../src/lib/api/student-portal";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { useTheme } from "../../src/theme/theme-provider";
import { spacing } from "../../src/theme/tokens";
import { Body, Button, CenteredMessage, Notice, Screen } from "../../src/components/ui";
import { CalendarList } from "../../src/components/calendar-list";
import { FreshnessLabel, useIsOnline } from "../../src/components/freshness-label";

// Phase 8 / CP1 — the school calendar for a student (docs/modules/phase-8.md §15).
// The same merged calendar a guardian sees (D27), keyed under "me" like every
// other student-surface query. Cached for a day and persisted — see the
// guardian screen (app/calendar.tsx) for why that is safe and useful here.
const ONE_DAY_MS = 1000 * 60 * 60 * 24;

export default function MyCalendarScreen() {
  const { status, principal } = useSession();
  const { colors } = useTheme();
  const online = useIsOnline();
  const calendarWindow = useMemo(() => defaultCalendarWindow(), []);

  const query = useQuery({
    queryKey: queryKeys.myCalendar(calendarWindow.from, calendarWindow.to),
    queryFn: () => getStudentCalendar(calendarWindow),
    enabled: status === "authenticated" && principal === "student",
    staleTime: ONE_DAY_MS,
  });

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") return <Redirect href="/calendar" />;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "School calendar" }} />
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
            <Body muted>Loading the calendar…</Body>
          </CenteredMessage>
        )}

        {query.isError && !query.data && (
          <CenteredMessage>
            <Notice tone="danger">
              {online ? "We couldn't load the calendar just now." : "You're offline and there's no saved copy yet."}
            </Notice>
            <Button title="Try again" variant="secondary" onPress={() => void query.refetch()} />
          </CenteredMessage>
        )}

        {query.data && (
          <>
            <FreshnessLabel updatedAt={query.dataUpdatedAt} />
            <CalendarList entries={query.data.entries} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
});
