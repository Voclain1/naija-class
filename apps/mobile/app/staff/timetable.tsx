import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { formatMinuteOfDay, type TeacherOwnLessonDto } from "@school-kit/types";

import { staffMyTimetable } from "../../src/lib/api/staff-schedule";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { serverToday } from "../../src/lib/staff/server-date";
import { useTheme } from "../../src/theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../../src/theme/tokens";
import {
  Body,
  Button,
  Card,
  CenteredMessage,
  Heading,
  Label,
  Notice,
  Screen,
} from "../../src/components/ui";

// CP7 (7) — the teacher's own timetable.
//
// A whole-week grid does not fit a phone, so this is ONE DAY at a time, opening
// on today. That is also how a teacher uses it: the question on a Tuesday
// morning is "what am I teaching today", not "show me the week".
//
// The endpoint is the narrow teacher one (`timetable.own.read`): their own
// lessons, plus read-only grids for classes they form-teach. The whole-school
// builder grid is a different permission and stays on web with owner/admin.

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** ISO weekday (1 = Monday … 7 = Sunday) for a yyyy-mm-dd date, in UTC. */
function isoWeekdayOf(date: string | null): number {
  if (date === null) return 1;
  const parsed = Date.parse(date + "T00:00:00.000Z");
  if (Number.isNaN(parsed)) return 1;
  const day = new Date(parsed).getUTCDay();
  return day === 0 ? 7 : day;
}

export default function TimetableScreen() {
  const { colors } = useTheme();
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const ready = authed && schoolId !== "" && userId !== "";

  const timetable = useQuery({
    queryKey: queryKeys.staffTimetable(schoolId, userId),
    queryFn: () => staffMyTimetable(),
    enabled: ready,
    staleTime: 5 * 60_000,
  });

  // Open on the server's today, not the handset's — the same rule the
  // attendance register follows.
  const [day, setDay] = useState<number | null>(null);
  const selectedDay = day ?? isoWeekdayOf(serverToday());

  const data = timetable.data;
  const slotById = useMemo(
    () => new Map((data?.slots ?? []).map((slot) => [slot.id, slot])),
    [data],
  );
  const lessons = useMemo(
    () =>
      (data?.ownLessons ?? [])
        .filter((lesson) => lesson.dayOfWeek === selectedDay)
        .sort((a, b) => a.slot.startMinute - b.slot.startMinute),
    [data, selectedDay],
  );

  if (status === "locked") return <Redirect href="/unlock" />;
  if (!authed) return <Redirect href="/login" />;

  const header = <Stack.Screen options={{ headerShown: true, title: "My timetable" }} />;
  const days = data?.schoolWeekDays ?? [1, 2, 3, 4, 5];

  if (timetable.isPending || (timetable.isError && !data)) {
    return (
      <Screen>
        {header}
        <CenteredMessage>
          {timetable.isError ? (
            <>
              <Notice tone="danger">We couldn&apos;t load your timetable. Try again shortly.</Notice>
              <Button
                title="Try again"
                variant="secondary"
                onPress={() => void timetable.refetch()}
              />
            </>
          ) : (
            <Body muted>Loading your timetable…</Body>
          )}
        </CenteredMessage>
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      <Heading>My timetable</Heading>
      <Body muted>{data?.term?.name ?? "No current term"}</Body>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipRow}
      >
        {days.map((weekday) => {
          const active = weekday === selectedDay;
          return (
            <Pressable
              key={weekday}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setDay(weekday)}
              style={[
                styles.chip,
                {
                  borderColor: colors.primary,
                  backgroundColor: active ? colors.primary : "transparent",
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? colors.primaryForeground : colors.primary },
                ]}
              >
                {DAY_NAMES[weekday]?.slice(0, 3) ?? weekday}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {!data?.term && (
          <Notice tone="warning">
            No term is active, so there is no timetable to show. Ask your school administrator.
          </Notice>
        )}

        {data?.term && lessons.length === 0 && (
          <Notice tone="info">
            Nothing scheduled for you on {DAY_NAMES[selectedDay] ?? "this day"}.
          </Notice>
        )}

        {lessons.map((lesson: TeacherOwnLessonDto, index) => (
          <Card key={`${lesson.slot.position}-${lesson.classArmId}-${index}`} style={styles.lesson}>
            <View style={styles.lessonHead}>
              <Body>{lesson.subjectName}</Body>
              <Label>
                {formatMinuteOfDay(lesson.slot.startMinute)}–
                {formatMinuteOfDay(lesson.slot.endMinute)}
              </Label>
            </View>
            <Label>
              {lesson.className} · {lesson.slot.label}
            </Label>
            {lesson.coTeacherNames.length > 0 ? (
              <Label>With {lesson.coTeacherNames.join(", ")}</Label>
            ) : null}
          </Card>
        ))}

        {/* Classes this teacher form-teaches: the whole class's day, which is
            what a form teacher is asked about by their students.

            These lessons reference a slot by id rather than embedding it (a
            form-class grid repeats the same slots for every lesson), so the
            time comes from the shared slot list. */}
        {(data?.formClasses ?? []).map((formClass) => {
          const dayLessons = formClass.lessons
            .filter((lesson) => lesson.dayOfWeek === selectedDay)
            .map((lesson) => ({
              lesson,
              slot: slotById.get(lesson.bellSlotId) ?? null,
            }))
            .sort((a, b) => (a.slot?.startMinute ?? 0) - (b.slot?.startMinute ?? 0));
          if (dayLessons.length === 0) return null;
          return (
            <Card key={formClass.classArmId} style={styles.lesson}>
              <Label>{formClass.className} — the whole class&apos;s day</Label>
              {dayLessons.map(({ lesson, slot }) => (
                <Body key={lesson.id} muted>
                  {slot ? `${formatMinuteOfDay(slot.startMinute)} ` : ""}
                  {lesson.subjectName}
                </Body>
              ))}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexGrow: 0, marginTop: spacing.sm },
  chips: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    justifyContent: "center",
  },
  chipText: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.body },
  content: { gap: spacing.sm, paddingVertical: spacing.md },
  lesson: { gap: spacing.xs },
  lessonHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing.sm,
  },
});
