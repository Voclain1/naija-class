import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatSickbayDay, formatSickbayTime, sickbayDayOf } from "@school-kit/types";

import { EmptyState, ScreenHeader, Skeleton } from "../../../src/components/layout";
import { LoadError } from "../../../src/components/load-error";
import { Body, Button, Caption, Card, Notice, Screen } from "../../../src/components/ui";
import { WebsiteLink } from "../../../src/components/website-link";
import { staffSickbayDay } from "../../../src/lib/api/staff-health";
import { hasPermission } from "../../../src/lib/auth/permissions";
import { useSession } from "../../../src/lib/auth/session";
import { queryKeys } from "../../../src/lib/query/keys";
import { shiftDay } from "../../../src/lib/staff/days";
import { spacing } from "../../../src/theme/tokens";

// Phase 9 / CP11.2 — the sickbay's visits a day at a time, read-only
// (docs/modules/phase-9.md §20; owner's answer: step back a day at a time).
// A visit today is recorded from the child's health record; an earlier day,
// and medicine given later, are on the website.

export default function SickbayDayScreen() {
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const canManage = hasPermission(staff?.permissions ?? [], "sickbay.manage");
  const today = sickbayDayOf(new Date());
  const [day, setDay] = useState(today);
  const visits = useQuery({
    queryKey: queryKeys.staffSickbayDay(staff?.school.id ?? "", staff?.user.id ?? "", day),
    queryFn: () => staffSickbayDay(day),
    enabled: authed && canManage,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const rows = (visits.data?.data ?? []).filter((v) => !v.withdrawnAt);
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, headerTitle: "" }} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={visits.isRefetching} onRefresh={() => void visits.refetch()} />}>
        <ScreenHeader title="Sickbay visits" subtitle={day === today ? "Today" : formatSickbayDay(`${day}T12:00:00+01:00`)} />
        {!canManage ? (
          <Notice tone="info">Your account can&apos;t see the sickbay log.</Notice>
        ) : (
          <>
            <View style={styles.nav}>
              <Button variant="secondary" title="Day before" onPress={() => setDay((d) => shiftDay(d, -1))} />
              <Button variant="secondary" title="Day after" disabled={day >= today} onPress={() => setDay((d) => shiftDay(d, 1))} />
            </View>
            {visits.isLoading ? (
              <Skeleton lines={3} />
            ) : visits.isError ? (
              <LoadError error={visits.error} what="sickbay visits" onRetry={() => void visits.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState icon="medkit-outline" title="No visits this day" body="Visits recorded here or on the website show in this list." />
            ) : (
              rows.map((v) => (
                <Card key={v.id} style={styles.card}>
                  <Body>{`${formatSickbayTime(v.visitedAt)} · ${v.studentName}${v.className ? ` (${v.className})` : ""}`}</Body>
                  {v.boarder ? <Caption>{`Boarder: ${v.boarder}`}</Caption> : null}
                  <Caption>{v.complaint}</Caption>
                  {v.actionTaken ? <Caption>{`Done: ${v.actionTaken}`}</Caption> : null}
                  {v.medications.map((m) => (
                    <Caption key={m.id}>{`${m.name}, ${m.dose} at ${formatSickbayTime(m.givenAt)}`}</Caption>
                  ))}
                  {v.sentHome ? <Notice tone="warning">Sent home</Notice> : null}
                </Card>
              ))
            )}
            <WebsiteLink path="/sickbay" title="Open the sickbay on the website" hint="Recording a visit on an earlier day, and medicine given later, are on the website." />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, paddingVertical: spacing.md, paddingBottom: spacing.xl },
  nav: { flexDirection: "row", gap: spacing.sm },
  card: { gap: spacing.xs },
});
