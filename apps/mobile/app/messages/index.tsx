import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { EmptyState, ListRow, ScreenHeader, Skeleton } from "../../src/components/layout";
import { LoadError } from "../../src/components/load-error";
import { Button, Screen } from "../../src/components/ui";
import { guardianMessages } from "../../src/lib/api/portal";
import { useSession } from "../../src/lib/auth/session";
import { queryKeys } from "../../src/lib/query/keys";
import { spacing } from "../../src/theme/tokens";

// Phase 9 / CP8.1 — a parent's private conversations with their child's
// teacher, the bursar or the school (docs/modules/phase-9.md §17.8). Only the
// person or office they wrote to sees each one.

function when(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function MessagesScreen() {
  const router = useRouter();
  const { status, principal } = useSession();
  const authed = status === "authenticated" && principal === "guardian";
  const list = useQuery({ queryKey: queryKeys.guardianMessages, queryFn: guardianMessages, enabled: authed });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (status === "guest") return <Redirect href="/login" />;
  if (status === "authenticated" && principal !== "guardian") return <Redirect href="/" />;

  const items = list.data?.items ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}>
        <ScreenHeader title="Messages" subtitle="Private, with your child's teachers and the school" />
        <Button title="Write a message" onPress={() => router.push("/messages/new")} />
        {list.isLoading ? (
          <Skeleton lines={3} />
        ) : list.isError ? (
          <LoadError error={list.error} what="messages" onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon="chatbubbles-outline" title="No messages yet." body="Write to your child's teacher, the bursar or the school office, and their reply will appear here." />
        ) : (
          items.map((t) => (
            <ListRow
              key={t.id}
              icon={t.unread ? "chatbubble-ellipses" : "chatbubbles-outline"}
              title={t.subject}
              subtitle={`${t.unread ? "New reply · " : ""}${t.status === "CLOSED" ? "Closed · " : ""}To ${t.withLabel}${t.childName ? ` · about ${t.childName}` : ""} · ${when(t.lastMessageAt)}`}
              onPress={() => router.push({ pathname: "/messages/[id]", params: { id: t.id } })}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingVertical: spacing.md, paddingBottom: spacing.xl },
});
