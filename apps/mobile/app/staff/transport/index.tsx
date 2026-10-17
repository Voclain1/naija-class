import { RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { ListRow, ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Card, Notice, Screen } from "../../../src/components/ui";
import { staffTransportRoutes } from "../../../src/lib/api/staff-transport";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP5.3 — the school's bus routes (docs/modules/phase-9.md §13): a
// way to the day's list for each. Setting routes up stays on the website.
export default function TransportRoutesScreen() {
  const router = useRouter();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canRead = hasPermission(staff?.permissions ?? [], "transport.read");
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";

  const routes = useQuery({
    queryKey: queryKeys.staffTransportRoutes(schoolId, userId),
    queryFn: staffTransportRoutes,
    enabled: authed && canRead,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const rows = routes.data ?? [];
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={routes.isRefetching} onRefresh={() => void routes.refetch()} />}
      >
        <ScreenHeader title="Bus routes" subtitle="Who to pick up, stop by stop" />
        {!canRead ? (
          <Notice tone="info">Your account can&apos;t see the bus routes.</Notice>
        ) : routes.isLoading ? (
          <Skeleton lines={4} />
        ) : routes.isError ? (
          <LoadError error={routes.error} what="routes" onRetry={() => void routes.refetch()} />
        ) : rows.length === 0 ? (
          <Card>
            <Body muted>No routes yet. Routes are set up on the website.</Body>
          </Card>
        ) : (
          rows.map((r) => (
            <ListRow
              key={r.id}
              icon="bus-outline"
              title={r.name}
              subtitle={`${r.vehicle ? r.vehicle.plate : "No vehicle"} · ${r.driver ? r.driver.name : "No driver"} · ${r.stops.length} ${
                r.stops.length === 1 ? "stop" : "stops"
              }`}
              onPress={() => router.push({ pathname: "/staff/transport/[routeId]", params: { routeId: r.id } })}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
});
