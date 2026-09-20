import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  formatMinuteOfDay,
  type TeacherOwnLessonDto,
  type TeacherTimetableDto,
} from "@school-kit/types";

import { staffMyTimetable } from "../../src/lib/api/staff-schedule";
import { queryKeys } from "../../src/lib/query/keys";
import { useSession } from "../../src/lib/auth/session";
import { TimetableGrid } from "../../src/components/timetable-grid";
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

// CP7 (7) — the teacher's own timetable, as a DAY or a WEEK.
//
// Day is the default because it answers the question a teacher actually has on
// a Tuesday morning — "what am I teaching today" — and it has room for the
// class, the period label and any co-teacher.
//
// Week exists because planning is a different question, and a teacher asked
// for it: "am I free on Thursday afternoon", "when do I teach JSS2 this week".
// A full week cannot fit a phone's width at a readable size, so the week grid
// SCROLLS SIDEWAYS with the period times pinned in the first column, and each
// cell is reduced to subject and class. Tapping a day heading in the week view
// drops back into that day in full.
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
  const [view, setView] = useState<"day" | "week">("day");
  const selectedDay = day ?? isoWeekdayOf(serverToday());
  const todayWeekday = isoWeekdayOf(serverToday());

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

      <View style={styles.viewToggle}>
        <Button
          title="Day"
          variant={view === "day" ? "primary" : "secondary"}
          onPress={() => setView("day")}
        />
        <Button
          title="Week"
          variant={view === "week" ? "primary" : "secondary"}
          onPress={() => setView("week")}
        />
      </View>

      {view === "day" && (
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
      )}

      {view === "week" ? (
        <WeekGrid
          days={days}
          slots={data?.slots ?? []}
          lessons={data?.ownLessons ?? []}
          todayWeekday={todayWeekday}
          onPickDay={(weekday) => {
            setDay(weekday);
            setView("day");
          }}
        />
      ) : (
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

        {/* Classes this teacher FORM-teaches. A form teacher is asked about
            the whole class's week — "what do we have after break on
            Wednesday" — so this is the same aligned table a student sees,
            not a list of the teacher's own lessons. */}
        {(data?.formClasses ?? []).map((formClass) => {
          const byDayAndSlot = new Map(
            formClass.lessons.map((lesson) => {
              const slot = slotById.get(lesson.bellSlotId);
              return [lesson.dayOfWeek + ":" + (slot?.position ?? -1), lesson];
            }),
          );
          return (
            <Card key={formClass.classArmId} style={styles.lesson}>
              <Label>{formClass.className} — the whole class</Label>
              <TimetableGrid
                days={days}
                slots={data?.slots ?? []}
                todayWeekday={todayWeekday}
                showTeachers
                lessonAt={(weekday, position) => {
                  const lesson = byDayAndSlot.get(weekday + ":" + position);
                  return lesson
                    ? {
                        subjectName: lesson.subjectName,
                        teacherNames: lesson.teachers.map((teacher) => teacher.name),
                      }
                    : null;
                }}
              />
            </Card>
          );
        })}
      </ScrollView>
      )}
    </Screen>
  );
}

/**
 * The week, scrolled sideways with the times pinned on the left.
 *
 * Only TEACHING slots get a row: a bell schedule usually carries break and
 * assembly slots too, and a week grid that spends a row on each of them pushes
 * the lessons off the screen. They stay visible in the day view, which has the
 * room for them.
 */
function WeekGrid({
  days,
  slots,
  lessons,
  todayWeekday,
  onPickDay,
}: {
  days: number[];
  slots: TeacherTimetableDto["slots"];
  lessons: TeacherOwnLessonDto[];
  todayWeekday: number;
  onPickDay: (weekday: number) => void;
}) {
  const { colors } = useTheme();
  const rows = slots
    .filter((slot) => slot.kind === "LESSON")
    .sort((a, b) => a.startMinute - b.startMinute);
  const byDayAndSlot = new Map<string, TeacherOwnLessonDto>();
  for (const lesson of lessons) {
    byDayAndSlot.set(lesson.dayOfWeek + ":" + lesson.slot.position, lesson);
  }

  if (rows.length === 0) {
    return (
      <Notice tone="info">
        Your school hasn&apos;t set up its periods yet, so there is no week to show.
      </Notice>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.weekScroll}>
      <View>
        <View style={styles.weekHeaderRow}>
          <View style={styles.timeColumn}>
            <Label>Time</Label>
          </View>
          {days.map((weekday) => (
            <Pressable
              key={weekday}
              accessibilityRole="button"
              accessibilityLabel={"Open " + (DAY_NAMES[weekday] ?? "day")}
              onPress={() => onPickDay(weekday)}
              style={styles.weekColumn}
            >
              <Text
                style={[
                  styles.weekHeading,
                  {
                    color: weekday === todayWeekday ? colors.primary : colors.mutedForeground,
                    fontFamily: weekday === todayWeekday ? fonts.sansSemibold : fonts.sans,
                  },
                ]}
              >
                {DAY_NAMES[weekday]?.slice(0, 3) ?? weekday}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={styles.weekBody}>
          {rows.map((slot) => (
            <View key={slot.id} style={[styles.weekRow, { borderTopColor: colors.border }]}>
              <View style={styles.timeColumn}>
                <Text style={[styles.slotTime, { color: colors.mutedForeground }]}>
                  {formatMinuteOfDay(slot.startMinute)}
                </Text>
              </View>
              {days.map((weekday) => {
                const lesson = byDayAndSlot.get(weekday + ":" + slot.position);
                return (
                  <View
                    key={weekday}
                    style={[
                      styles.weekColumn,
                      styles.weekCell,
                      lesson
                        ? { backgroundColor: colors.card, borderColor: colors.primary }
                        : { borderColor: "transparent" },
                    ]}
                  >
                    {lesson ? (
                      <>
                        <Text
                          numberOfLines={2}
                          style={[styles.cellSubject, { color: colors.foreground }]}
                        >
                          {lesson.subjectName}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[styles.cellClass, { color: colors.mutedForeground }]}
                        >
                          {lesson.className}
                        </Text>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  viewToggle: { flexDirection: "row", gap: spacing.sm, paddingTop: spacing.sm },
  weekScroll: { paddingVertical: spacing.md },
  weekHeaderRow: { flexDirection: "row", alignItems: "center" },
  weekBody: { flexGrow: 0 },
  weekRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, minHeight: 56 },
  timeColumn: { width: 56, paddingVertical: spacing.sm, paddingRight: spacing.xs },
  weekColumn: { width: 104, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs },
  weekCell: { borderWidth: 1, borderRadius: radii.sm, justifyContent: "center" },
  weekHeading: { fontSize: fontSizes.body, textAlign: "center", paddingVertical: spacing.sm },
  slotTime: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
  cellSubject: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption },
  cellClass: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
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
