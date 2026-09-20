import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  CALENDAR_CATEGORY_LABELS,
  formatCalendarRange,
  type CalendarEntryCategory,
  type CalendarEntryDto,
} from "@school-kit/types";

import { useTheme } from "../theme/theme-provider";
import { fontSizes, fonts, radii, spacing } from "../theme/tokens";
import {
  buildMonthGrid,
  entriesOnDate,
  formatMonth,
  shiftMonth,
  WEEKDAY_INITIALS,
} from "../lib/calendar/month-grid";
import { Body, Button, Card, Label } from "./ui";

// A month grid, in the shape people already know from their phone's calendar:
// the dates laid out as weeks, a dot on any day something happens, and the
// day's events listed when you tap it.
//
// Why a grid rather than the list this replaced: a list answers "what is
// coming up", but a teacher looking at a calendar is usually asking "what is
// happening ON a date" — is the 16th free, when does the break start, how many
// days until exams. A list makes you count; a grid shows it.
//
// The dots carry category colour but the day list carries the words. Colour
// alone is never the only signal — a legend nobody remembers is not
// information, and some teachers will not distinguish the hues at a glance.

const MAX_DOTS = 3;

interface Props {
  entries: CalendarEntryDto[];
  month: string;
  selectedDate: string | null;
  today: string | null;
  onSelectDate: (date: string) => void;
  onChangeMonth: (month: string) => void;
}

export function CalendarMonth({
  entries,
  month,
  selectedDate,
  today,
  onSelectDate,
  onChangeMonth,
}: Props) {
  const { colors } = useTheme();
  const grid = useMemo(() => buildMonthGrid(month), [month]);

  function dotColor(category: CalendarEntryCategory): string {
    switch (category) {
      case "HOLIDAY":
      case "PUBLIC_HOLIDAY":
      case "BREAK":
        return colors.secondary;
      case "EXAM_PERIOD":
        return colors.danger;
      default:
        return colors.primary;
    }
  }

  const selectedEntries = selectedDate ? entriesOnDate(entries, selectedDate) : [];

  return (
    <>
      <Card style={styles.card}>
        <View style={styles.monthBar}>
          <Button
            title="‹"
            variant="secondary"
            onPress={() => onChangeMonth(shiftMonth(month, -1))}
          />
          <Body>{formatMonth(month)}</Body>
          <Button title="›" variant="secondary" onPress={() => onChangeMonth(shiftMonth(month, 1))} />
        </View>

        <View style={styles.weekRow}>
          {WEEKDAY_INITIALS.map((initial, index) => (
            <View key={index} style={styles.cell}>
              <Text style={[styles.weekday, { color: colors.mutedForeground }]}>{initial}</Text>
            </View>
          ))}
        </View>

        <View style={styles.grid}>
          {grid.map((cell) => {
            const dayEntries = entriesOnDate(entries, cell.date);
            const isToday = cell.date === today;
            const isSelected = cell.date === selectedDate;
            return (
              <Pressable
                key={cell.date}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${cell.date}${
                  dayEntries.length > 0 ? `, ${dayEntries.length} event` : ", nothing"
                }${dayEntries.length > 1 ? "s" : ""}`}
                onPress={() => onSelectDate(cell.date)}
                style={[
                  styles.cell,
                  styles.dayCell,
                  isSelected && { backgroundColor: colors.primary, borderRadius: radii.md },
                  !isSelected && isToday && { borderColor: colors.primary, borderWidth: 1, borderRadius: radii.md },
                ]}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    {
                      color: isSelected
                        ? colors.primaryForeground
                        : cell.inMonth
                          ? colors.foreground
                          : colors.mutedForeground,
                      fontFamily: isToday ? fonts.sansSemibold : fonts.sans,
                      // Days from the neighbouring months stay visible but
                      // recede: hiding them would leave holes in the weeks.
                      opacity: cell.inMonth ? 1 : 0.45,
                    },
                  ]}
                >
                  {cell.dayOfMonth}
                </Text>
                <View style={styles.dots}>
                  {dayEntries.slice(0, MAX_DOTS).map((entry) => (
                    <View
                      key={entry.id}
                      style={[
                        styles.dot,
                        {
                          backgroundColor: isSelected
                            ? colors.primaryForeground
                            : dotColor(entry.category),
                        },
                      ]}
                    />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      </Card>

      {selectedDate ? (
        <Card style={styles.card}>
          <Label>{formatCalendarRange(selectedDate, selectedDate)}</Label>
          {selectedEntries.length === 0 ? (
            <Body muted>Nothing on this day.</Body>
          ) : (
            selectedEntries.map((entry) => (
              <View key={entry.id} style={styles.entry}>
                <Body>{entry.title}</Body>
                <Label>
                  {CALENDAR_CATEGORY_LABELS[entry.category]}
                  {entry.startDate === entry.endDate
                    ? ""
                    : ` · ${formatCalendarRange(entry.startDate, entry.endDate)}`}
                  {entry.dateConfirmed ? "" : " · date not confirmed"}
                </Label>
                {entry.description ? <Body muted>{entry.description}</Body> : null}
              </View>
            ))
          )}
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  weekRow: { flexDirection: "row" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, alignItems: "center" },
  dayCell: { paddingVertical: spacing.sm, minHeight: 48, justifyContent: "center" },
  weekday: { fontFamily: fonts.sansSemibold, fontSize: fontSizes.caption },
  dayNumber: { fontSize: fontSizes.body },
  dots: { flexDirection: "row", gap: 2, height: 6, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  entry: { gap: spacing.xs, paddingTop: spacing.xs },
});
