import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatSickbayDay } from "@school-kit/types";

import { EmptyState, ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Caption, Card, Label, Notice, Screen } from "../../../src/components/ui";
import { WebsiteLink } from "../../../src/components/website-link";
import { staffBehaviourIncidents } from "../../../src/lib/api/staff-behaviour";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { groupByDay } from "../../../src/lib/staff/days";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP11.2 — behaviour incidents, read-only (docs/modules/phase-9.md
// §20). The server decides what each person sees: a teacher their own
// classes, an owner or admin everything. Recording one stays on the class
// screen; categories stay on the website.

export default function IncidentsScreen() {
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canRead = hasPermission(staff?.permissions ?? [], "behaviour.read");
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: queryKeys.staffBehaviourIncidents(staff?.school.id ?? "", staff?.user.id ?? ""),
    queryFn: staffBehaviourIncidents,
    enabled: authed && canRead,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const days = groupByDay(list.data?.data ?? [], (i) => i.occurredOn.slice(0, 10));
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}>
        <ScreenHeader title="Incidents" subtitle="Behaviour incidents recorded" />
        {!canRead ? (
          <Notice tone="info">Your account can&apos;t see behaviour records.</Notice>
        ) : list.isLoading ? (
          <Skeleton lines={4} />
        ) : list.isError ? (
          <LoadError error={list.error} what="incidents" onRetry={() => void list.refetch()} />
        ) : days.length === 0 ? (
          <EmptyState icon="alert-circle-outline" title="No incidents recorded" body="Incidents recorded here or on the website show in this list." />
        ) : (
          days.map((d) => (
            <Card key={d.day} style={styles.day}>
              <Label>{formatSickbayDay(`${d.day}T12:00:00+01:00`)}</Label>
              {d.items.map((i) => {
                const expanded = open === i.id;
                return (
                  <Pressable
                    key={i.id}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`Incident at ${i.place}, ${i.students.map((s) => s.name).join(", ")}`}
                    onPress={() => setOpen(expanded ? null : i.id)}
                    style={styles.item}
                  >
                    <Body>{`${i.place} · ${i.students.map((s) => s.name).join(", ")}`}</Body>
                    {i.withdrawnAt ? <Caption>Withdrawn</Caption> : null}
                    {expanded ? (
                      <>
                        <Caption>{i.description}</Caption>
                        {i.students.map((s) => (s.note ? <Caption key={s.recordId}>{`${s.name}: ${s.note}`}</Caption> : null))}
                        {i.witnesses.length > 0 ? <Caption>{`Witnesses: ${i.witnesses.map((w) => w.name).join(", ")}`}</Caption> : null}
                        <Caption>{`Recorded by ${i.recordedByName ?? "a member of staff"}`}</Caption>
                      </>
                    ) : null}
                  </Pressable>
                );
              })}
            </Card>
          ))
        )}
        <WebsiteLink path="/settings/behaviour" title="Behaviour categories on the website" hint="Categories and points are set on the website." />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingVertical: spacing.md, paddingBottom: spacing.xl },
  day: { gap: spacing.sm },
  item: { gap: spacing.xs },
});
