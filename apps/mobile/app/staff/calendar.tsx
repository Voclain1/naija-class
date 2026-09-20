import { useMemo, useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { staffCalendar } from "../../src/lib/api/staff-schedule";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { serverToday } from "../../src/lib/staff/server-date";
import { CalendarMonth } from "../../src/components/calendar-month";
import { monthBounds, monthOf } from "../../src/lib/calendar/month-grid";
import { spacing } from "../../src/theme/tokens";
import {
  Body,
  Button,
  CenteredMessage,
  Heading,
  Notice,
  Screen,
} from "../../src/components/ui";

// CP7 (7) — the school calendar, as a MONTH GRID.
//
// A list of upcoming events answers "what is next"; a teacher looking at a
// calendar is usually asking "what is happening ON a date" — is the 16th
// free, when does the break start, how far away are exams. The grid answers
// that without counting.
//
// The window follows the month on screen rather than being a fixed six-month
// span, so paging back to last term is an ordinary thing to do. The query key
// carries the window, so each month is cached in its own right.
//
// Deliberately the STAFF endpoint (`calendar-event.read`), not the portal one
// the family screens use: same shape on the wire, different session and
// permission, and borrowing the portal route with a staff token would work by
// accident today and break the moment either surface's rules change.

export default function StaffCalendarScreen() {
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";

  // Open on the server's month, not the handset's.
  const today = serverToday();
  const [month, setMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const visibleMonth = month ?? (today ? monthOf(today) : monthOf(new Date().toISOString().slice(0, 10)));

  const window = useMemo(() => monthBounds(visibleMonth), [visibleMonth]);

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
      <Body muted>Term dates, holidays and school events. Tap a day to see what is on.</Body>

      <ScrollView contentContainerStyle={styles.content}>
        <CalendarMonth
          entries={calendar.data?.entries ?? []}
          month={visibleMonth}
          selectedDate={selectedDate}
          today={today}
          onSelectDate={setSelectedDate}
          onChangeMonth={(next) => {
            setMonth(next);
            // A date from the month being left would sit outside the grid.
            setSelectedDate(null);
          }}
        />

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
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.md },
});
