import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { studentAnnouncements, markStudentAnnouncementRead } from "../../src/lib/api/student-portal";
import { queryKeys } from "../../src/lib/query/keys";
import { AnnouncementFeed } from "../../src/components/announcement-feed";
import { useSession } from "../../src/lib/auth/session";
import { useTheme } from "../../src/theme/theme-provider";
import { spacing } from "../../src/theme/tokens";
import { Body, Button, CenteredMessage, Notice, Screen } from "../../src/components/ui";
import { EmptyState } from "../../src/components/layout";
import { FreshnessLabel } from "../../src/components/freshness-label";

// What the school has sent this student (docs/modules/announcements.md).
//
// The same feed the parent screen renders, from the student's own endpoint:
// the server decides a student sees what went to EVERYONE and to their class,
// never the PARENTS or STAFF audiences. Persisted and readable offline for
// the same reason the calendar is — a child checking "is there school
// tomorrow" on a handset with no data is exactly who that cache is for.

const ONE_HOUR_MS = 1000 * 60 * 60;

export default function MyAnnouncementsScreen() {
  const { status, principal } = useSession();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.myAnnouncements,
    queryFn: () => studentAnnouncements(),
    enabled: status === "authenticated" && principal === "student",
    staleTime: ONE_HOUR_MS,
  });

  const mark = useMutation({
    mutationFn: (id: string) => markStudentAnnouncementRead(id),
    // The list is not refetched per item — a parent scrolling past five
    // messages would otherwise fire five reloads. The next open picks up the
    // read state; invalidating once on success is enough.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myAnnouncements, refetchType: "none" });
    },
  });
  const onRead = useCallback((id: string) => mark.mutate(id), [mark]);

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "student") return <Redirect href="/announcements" />;

  const data = query.data;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "From the school" }} />
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
            <Notice tone="danger">We couldn&apos;t load your school&apos;s messages.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void query.refetch()} />
          </CenteredMessage>
        )}

        {data && (
          <>
            <FreshnessLabel updatedAt={query.dataUpdatedAt} />
            {data.data.length === 0 ? (
              <EmptyState
                icon="megaphone-outline"
                title="Nothing yet"
                body="Messages from your school will appear here."
              />
            ) : (
              <AnnouncementFeed items={data.data} onRead={onRead} />
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
