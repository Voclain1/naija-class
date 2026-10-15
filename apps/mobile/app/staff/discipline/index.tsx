import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { DisciplineRow } from "../../../src/components/discipline-card";
import { ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Card, Notice, Screen } from "../../../src/components/ui";
import { staffDisciplineQueue } from "../../../src/lib/api/staff-behaviour";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP2.3 — the discipline decisions queue, for an owner or admin
// (docs/modules/phase-9.md §9 CP2-D3). The same list as the website's
// Behaviour page. Nobody decides their own proposal: the API marks those rows
// `canDecide: false`, and this screen just shows what it was given.
export default function DisciplineDecisionsScreen() {
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canRead = hasPermission(staff?.permissions ?? [], "behaviour.read");
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const queryClient = useQueryClient();
  const key = queryKeys.staffDisciplineQueue(schoolId, userId);
  const queue = useQuery({ queryKey: key, queryFn: staffDisciplineQueue, enabled: authed && canRead });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const actions = queue.data?.data ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={queue.isRefetching} onRefresh={() => void queue.refetch()} />}
      >
        <ScreenHeader title="Behaviour decisions" subtitle="Proposed discipline actions" />
        {!canRead ? (
          <Notice tone="info">Your account can&apos;t see discipline actions.</Notice>
        ) : queue.isLoading ? (
          <Skeleton lines={3} />
        ) : queue.isError ? (
          <LoadError error={queue.error} what="the decisions" onRetry={() => void queue.refetch()} />
        ) : actions.length === 0 ? (
          <Card>
            <Body muted>Nothing is waiting for a decision.</Body>
          </Card>
        ) : (
          <Card>
            {actions.map((a) => (
              <DisciplineRow key={a.id} action={a} showStudent onChanged={refresh} />
            ))}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
});
