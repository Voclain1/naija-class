import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { getMyTimetable } from "../../src/lib/api/student-portal";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { useTheme } from "../../src/theme/theme-provider";
import { spacing } from "../../src/theme/tokens";
import { Body, Button, CenteredMessage, Notice, Screen } from "../../src/components/ui";
import { FamilyTimetable } from "../../src/components/family-timetable";
import { FreshnessLabel, useIsOnline } from "../../src/components/freshness-label";

// Phase 8 / CP4 — a student's class timetable (docs/modules/phase-8.md §18 D39, D45).
// Only what the school PUBLISHED is ever returned: a timetable still being
// edited is not visible here. Cached for an hour and persisted for offline use.
const ONE_HOUR_MS = 1000 * 60 * 60;

export default function MyTimetableScreen() {
  const { status, principal } = useSession();
  const { colors } = useTheme();
  const online = useIsOnline();

  const query = useQuery({
    queryKey: queryKeys.myTimetable,
    queryFn: () => getMyTimetable(),
    enabled: status === "authenticated" && principal === "student",
    staleTime: ONE_HOUR_MS,
  });

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") return <Redirect href="/students" />;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "My timetable" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />
        }
      >
        {query.isPending && (
          <CenteredMessage>
            <Body muted>Loading the timetable…</Body>
          </CenteredMessage>
        )}

        {query.isError && !query.data && (
          <CenteredMessage>
            <Notice tone="danger">
              {online ? "We couldn't load the timetable just now." : "You're offline and there's no saved copy yet."}
            </Notice>
            <Button title="Try again" variant="secondary" onPress={() => void query.refetch()} />
          </CenteredMessage>
        )}

        {query.data && (
          <>
            <FreshnessLabel updatedAt={query.dataUpdatedAt} />
            <FamilyTimetable data={query.data} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md },
});
