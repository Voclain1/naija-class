import { ScrollView, StyleSheet, Text, View } from "react-native";
import { formatMinuteOfDay, ISO_WEEKDAY_LABELS, type BellSlotKind } from "@school-kit/types";

import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import { Label, Notice } from "./ui";

// A CLASS timetable as a table: days across, periods down, subjects aligned in
// the cells — the shape a printed school timetable has always had, and the one
// a student or form teacher is looking for.
//
// This is deliberately NOT how a teacher's own timetable renders. A teacher's
// lessons are scattered across classes and are mostly empty space, so a grid of
// their week is mostly blank; a class's timetable is dense by definition, every
// period filled, and the alignment IS the information — "what follows Maths on
// Tuesday" is a question you answer by reading down a column.
//
// The width of five days of readable cells exceeds a phone, so the table
// scrolls sideways with the times pinned in the first column. Non-teaching
// slots (break, assembly) keep their row here, unlike the teacher's week view:
// on a class timetable break is part of the day's shape, and removing it would
// make the periods either side look adjacent when they are not.

export interface GridSlot {
  position: number;
  label: string;
  kind: BellSlotKind;
  startMinute: number;
  endMinute: number;
}

export interface GridLesson {
  subjectName: string;
  teacherNames?: string[];
}

interface Props {
  days: number[];
  slots: GridSlot[];
  /** Null when the class has a free period in that slot. */
  lessonAt: (dayOfWeek: number, slotPosition: number) => GridLesson | null;
  /** Highlighted column — the server's today, where the caller knows it. */
  todayWeekday?: number | null;
  /** Shown under each subject. Off for a student reading their own class. */
  showTeachers?: boolean;
}

export function TimetableGrid({
  days,
  slots,
  lessonAt,
  todayWeekday = null,
  showTeachers = false,
}: Props) {
  const { colors } = useTheme();
  const rows = [...slots].sort((a, b) => a.startMinute - b.startMinute);

  if (rows.length === 0 || days.length === 0) {
    return <Notice tone="info">This timetable has no periods set up yet.</Notice>;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroll}>
      <View>
        <View style={styles.headerRow}>
          <View style={styles.timeColumn}>
            <Label>Time</Label>
          </View>
          {days.map((day) => {
            const isToday = day === todayWeekday;
            return (
              <View key={day} style={styles.dayColumn}>
                <Text
                  style={[
                    styles.dayHeading,
                    {
                      color: isToday ? colors.primary : colors.mutedForeground,
                      fontFamily: isToday ? fonts.sansSemibold : fonts.sans,
                    },
                  ]}
                >
                  {ISO_WEEKDAY_LABELS[day]?.slice(0, 3) ?? day}
                </Text>
              </View>
            );
          })}
        </View>

        {rows.map((slot) => {
          const isLesson = slot.kind === "LESSON";
          return (
            <View key={slot.position} style={[styles.row, { borderTopColor: colors.border }]}>
              <View style={styles.timeColumn}>
                <Text style={[styles.time, { color: colors.mutedForeground }]}>
                  {formatMinuteOfDay(slot.startMinute)}
                </Text>
                <Text style={[styles.time, { color: colors.mutedForeground }]}>
                  {formatMinuteOfDay(slot.endMinute)}
                </Text>
              </View>

              {/* A break spans the width rather than repeating itself in every
                  column: it is the same break for the whole class. */}
              {!isLesson ? (
                <View style={[styles.breakRow, { backgroundColor: colors.border }]}>
                  <Text style={[styles.breakLabel, { color: colors.mutedForeground }]}>
                    {slot.label}
                  </Text>
                </View>
              ) : (
                days.map((day) => {
                  const lesson = lessonAt(day, slot.position);
                  return (
                    <View
                      key={day}
                      accessibilityLabel={`${ISO_WEEKDAY_LABELS[day] ?? day}, ${formatMinuteOfDay(
                        slot.startMinute,
                      )}, ${lesson ? lesson.subjectName : "free"}`}
                      style={[
                        styles.dayColumn,
                        styles.cell,
                        lesson
                          ? { backgroundColor: colors.card, borderColor: colors.primary }
                          : { borderColor: "transparent" },
                      ]}
                    >
                      {lesson ? (
                        <>
                          <Text
                            numberOfLines={2}
                            style={[styles.subject, { color: colors.foreground }]}
                          >
                            {lesson.subjectName}
                          </Text>
                          {showTeachers && lesson.teacherNames && lesson.teacherNames.length > 0 ? (
                            <Text
                              numberOfLines={1}
                              style={[styles.teacher, { color: colors.mutedForeground }]}
                            >
                              {lesson.teacherNames.join(", ")}
                            </Text>
                          ) : null}
                        </>
                      ) : (
                        <Text style={[styles.free, { color: colors.mutedForeground }]}>—</Text>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center" },
  row: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, minHeight: 58 },
  timeColumn: { width: 56, paddingVertical: spacing.sm, paddingRight: spacing.xs },
  dayColumn: { width: 104, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs },
  cell: { borderWidth: 1, borderRadius: radii.sm, justifyContent: "center" },
  dayHeading: { fontSize: fontSizes.body, textAlign: "center", paddingVertical: spacing.sm },
  time: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
  subject: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption },
  teacher: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
  free: { fontFamily: fonts.sans, fontSize: fontSizes.caption, textAlign: "center" },
  breakRow: {
    flex: 1,
    borderRadius: radii.sm,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: spacing.xs,
  },
  breakLabel: { fontFamily: fonts.sans, fontSize: fontSizes.caption },
});
