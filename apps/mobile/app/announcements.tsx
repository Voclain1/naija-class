import { useCallback } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { guardianAnnouncements, markGuardianAnnouncementRead } from "../src/lib/api/portal";
import { queryKeys } from "../src/lib/query/keys";
import { AnnouncementFeed } from "../src/components/announcement-feed";
import { useSession } from "../src/lib/auth/session";
import { useTheme } from "../src/theme/theme-provider";
import { spacing } from "../src/theme/tokens";
import { Body, Button, CenteredMessage, Notice, Screen } from "../src/components/ui";
import { EmptyState } from "../src/components/layout";
import { FreshnessLabel } from "../src/components/freshness-label";

// What the school has sent this parent (docs/modules/announcements.md).
//
// Persisted and read offline on purpose, like the calendar and released
// results: "the gate is closed tomorrow, do not bring the children" is exactly
// the message a parent needs to reread on a bus with no signal. The freshness
// label is what keeps that honest — a cached feed says when it was last
// fetched rather than pretending to be current.

const ONE_HOUR_MS = 1000 * 60 * 60;

export default function AnnouncementsScreen() {
  const { status, principal } = useSession();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.guardianAnnouncements,
    queryFn: () => guardianAnnouncements(),
    enabled: status === "authenticated" && principal === "guardian",
    staleTime: ONE_HOUR_MS,
  });

  const mark = useMutation({
    mutationFn: (id: string) => markGuardianAnnouncementRead(id),
    // The list is not refetched per item — a parent scrolling past five
    // messages would otherwise fire five reloads. The next open picks up the
    // read state; invalidating once on success is enough.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.guardianAnnouncements, refetchType: "none" });
    },
  });
  const onRead = useCallback((id: string) => mark.mutate(id), [mark]);

  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal === "student") return <Redirect href="/me/announcements" />;

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
            <Notice tone="danger">We couldn&apos;t load the school&apos;s messages.</Notice>
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
                body="Announcements from the school will appear here."
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
