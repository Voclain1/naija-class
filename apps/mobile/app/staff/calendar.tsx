import { useMemo } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { defaultCalendarWindow } from "@school-kit/types";

import { staffCalendar } from "../../src/lib/api/staff-schedule";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { CalendarList } from "../../src/components/calendar-list";
import { spacing } from "../../src/theme/tokens";
import {
  Body,
  Button,
  CenteredMessage,
  Heading,
  Notice,
  Screen,
} from "../../src/components/ui";

// CP7 (7) — the school calendar, for staff.
//
// Deliberately the STAFF endpoint (`/calendar`, `calendar-event.read`) rather
// than the portal one the guardian and student screens use: same shape on the
// wire, different session and different permission. Reusing the portal route
// with a staff token would work by accident today and break the moment either
// surface's rules change.
//
// The list itself is the shared CalendarList component, so a holiday is worded
// identically for a teacher and for a parent.

export default function StaffCalendarScreen() {
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";

  const window = useMemo(() => defaultCalendarWindow(), []);

  const calendar = useQuery({
    queryKey: queryKeys.staffCalendar(schoolId, userId, window.from, window.to),
    queryFn: () => staffCalendar(window),
    enabled: authed && schoolId !== "" && userId !== "",
    staleTime: 5 * 60_000,
  });

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "School calendar" }} />
      <Heading>School calendar</Heading>
      <Body muted>Term dates, holidays and school events.</Body>

      <ScrollView contentContainerStyle={styles.content}>
        {calendar.isPending && (
          <CenteredMessage>
            <Body muted>Loading the calendar…</Body>
          </CenteredMessage>
        )}

        {calendar.isError && !calendar.data && (
          <CenteredMessage>
            <Notice tone="danger">We couldn&apos;t load the calendar. Try again shortly.</Notice>
            <Button title="Try again" variant="secondary" onPress={() => void calendar.refetch()} />
          </CenteredMessage>
        )}

        {calendar.data ? <CalendarList entries={calendar.data.entries} /> : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
});
