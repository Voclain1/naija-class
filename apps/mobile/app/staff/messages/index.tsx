import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { ChoiceChips } from "../../../src/components/form";
import { EmptyState, ListRow, ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Notice, Screen } from "../../../src/components/ui";
import { staffMessages, type StaffMessageBox } from "../../../src/lib/api/staff-messages";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP8.1 — parents' messages addressed or passed to this person, and
// only those (docs/modules/phase-9.md §17.8). Writing to a parent first is the
// school office's, on the website.

function when(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function StaffMessagesScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canRead = hasPermission(staff?.permissions ?? [], "messages.read");
  // CP8.2: the owner and admins also have Flagged.
  const canOversee = hasPermission(staff?.permissions ?? [], "messages.oversee");
  const [box, setBox] = useState<StaffMessageBox>("OPEN");
  const list = useQuery({
    queryKey: queryKeys.staffMessages(staff?.school.id ?? "", staff?.user.id ?? "", box),
    queryFn: () => staffMessages(box),
    enabled: authed && canRead,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const items = list.data?.items ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}>
        <ScreenHeader title="Messages" subtitle={list.data && list.data.unread > 0 ? `${list.data.unread} unread` : "From parents"} />
        {!canRead ? (
          <Notice tone="info">Your account can&apos;t see messages.</Notice>
        ) : (
          <>
            <ChoiceChips
              options={[
                { value: "OPEN" as const, label: "Open" },
                { value: "CLOSED" as const, label: "Closed" },
                ...(canOversee ? [{ value: "FLAGGED" as const, label: "Flagged" }] : []),
              ]}
              value={box}
              onChange={setBox}
            />
            {list.isLoading ? (
              <Skeleton lines={3} />
            ) : list.isError ? (
              <LoadError error={list.error} what="messages" onRetry={() => void list.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState icon="chatbubbles-outline" title={box === "OPEN" ? "No open conversations." : box === "CLOSED" ? "No closed conversations." : "No flagged conversations."} body="Messages parents address or pass to you appear here. Nobody else at the school can see them." />
            ) : (
              items.map((t) => (
                <ListRow
                  key={t.id}
                  icon={t.unread ? "chatbubble-ellipses" : "chatbubbles-outline"}
                  title={t.subject}
                  subtitle={`${t.flag ? `Flagged: ${t.flag.label} · ` : ""}${t.unread ? "New · " : ""}${t.withLabel} · ${when(t.lastMessageAt)}${t.handledBy ? ` · ${t.handledBy} is handling it` : ""}`}
                  onPress={() => router.push({ pathname: "/staff/messages/[threadId]", params: { threadId: t.id } })}
                />
              ))
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingVertical: spacing.md, paddingBottom: spacing.xl },
});
