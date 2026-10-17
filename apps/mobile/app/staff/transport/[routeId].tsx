import { useState } from "react";
import { Linking, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatMinuteOfDay, lagosTodayIso } from "@school-kit/types";

import { ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Button, Caption, Card, Label, Notice, Screen } from "../../../src/components/ui";
import { staffTransportDaily } from "../../../src/lib/api/staff-transport";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP5.3 — one route's list for a day (docs/modules/phase-9.md §13
// CP5-D9): the stops in order with pickup times, each child and class, and a
// button to call the primary guardian. Confidential, and never kept on the
// phone (the query key is staff-prefixed, which the persister skips).

function shiftDay(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function RouteDayScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const [date, setDate] = useState(() => lagosTodayIso());
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";

  const day = useQuery({
    queryKey: queryKeys.staffTransportDaily(schoolId, userId, routeId ?? "", date),
    queryFn: () => staffTransportDaily(routeId ?? "", date),
    enabled: authed && !!routeId,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const list = day.data;
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={day.isRefetching} onRefresh={() => void day.refetch()} />}
      >
        <ScreenHeader
          title={list?.route.name ?? "Route"}
          subtitle={`${date}${list?.route.vehiclePlate ? ` · ${list.route.vehiclePlate}` : ""}`}
        />
        <View style={styles.dayRow}>
          <Button variant="secondary" title="Day before" onPress={() => setDate((d) => shiftDay(d, -1))} />
          <Button variant="secondary" title="Day after" onPress={() => setDate((d) => shiftDay(d, 1))} />
        </View>
        <Notice tone="info">Confidential: for the driver&apos;s use on this route.</Notice>
        {day.isLoading ? (
          <Skeleton lines={5} />
        ) : day.isError ? (
          <LoadError error={day.error} what="the route list" onRetry={() => void day.refetch()} />
        ) : !list ? null : (
          <>
            {list.route.driverName ? (
              <Caption>
                Driver: {list.route.driverName}
                {list.route.driverPhone ? `, ${list.route.driverPhone}` : ""}
              </Caption>
            ) : null}
            {list.termId === null ? <Body muted>That day is not in any term.</Body> : null}
            <Caption>
              {list.total} {list.total === 1 ? "child" : "children"}
            </Caption>
            {list.stops.map((s, i) => (
              <Card key={s.id}>
                <Label>
                  {i + 1}. {s.name}
                  {s.pickupMinute !== null ? ` · ${formatMinuteOfDay(s.pickupMinute)}` : ""}
                </Label>
                {s.children.length === 0 ? (
                  <Body muted>No one at this stop.</Body>
                ) : (
                  s.children.map((c) => (
                    <View key={c.studentId} style={styles.child}>
                      <Body>
                        {c.name}
                        {c.classArm ? ` · ${c.classArm}` : ""}
                      </Body>
                      {c.guardianPhone ? (
                        <Button
                          variant="secondary"
                          title={`Call parent (${c.guardianPhone})`}
                          onPress={() => void Linking.openURL(`tel:${c.guardianPhone}`)}
                        />
                      ) : (
                        <Caption>No parent phone recorded</Caption>
                      )}
                    </View>
                  ))
                )}
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
  dayRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  child: { gap: spacing.xs, paddingVertical: spacing.xs },
});
